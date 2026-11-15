import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProjectAgent, ProjectRuntimeError, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

async function fixture(t: TestContext) {
  const root = path.resolve('.local/case-star-map-implementation/tdd/runtime/fixtures', randomUUID());
  const projectDirectory = path.join(root, 'project');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  const provider = await startToolProvider();
  const options = {
    projectId: randomUUID(), taskId: randomUUID(), projectDirectory,
    sessionDirectory: path.join(root, 'native'), resourceRoot: path.join(root, 'pi'), codeRoot: process.cwd(), managementPorts: [],
    configuration: { id: 'relations-synthetic', revision: 1, name: 'Case relation synthetic', provider: 'synthetic', model: 'synthetic', api: 'openai-completions' as const, apiKey: 'synthetic-relation-only', baseUrl: provider.baseUrl },
  };
  const agents: ProjectAgent[] = [];
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); });
  return { root, options, provider, create: (extra: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...extra }); agents.push(agent); return agent; } };
}

test('SM07/A04 ordinary Pi exposes only the two narrow relationship tools without calling a model on open', async t => {
  const f = await fixture(t);
  const caseRelations = async () => ({ content: [{ type: 'text' as const, text: 'unused' }], details: {} });
  const agent = f.create({ caseRelations });
  const opened = await agent.open();
  assert.ok(opened.tools.includes('read_case_relations'), 'the original ordinary Pi resource must expose the approved read capability');
  assert.ok(opened.tools.includes('save_case_relation'), 'the original ordinary Pi resource must expose the approved write capability');
  assert.equal(f.provider.requests.length, 0, 'viewing capabilities must not run a Provider');
});

test('SM07/A04 actual Pi direct reads and legal nested saves use the original request/session/tool identity', { timeout: 60_000 }, async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested save' : 'direct read', async t => {
    const f = await fixture(t), calls: Record<string, unknown>[] = [];
    const input = nested
      ? { fromCaseId: randomUUID(), kind: 'follows_up', expectedRelationRevision: 0, explanation: '由历史问题继续补证。', targetScope: '当前事项的下一次核对', sources: [] }
      : { pageSize: 5, includeUnlinked: true };
    const agent = f.create({ caseRelations: async (action, value, context) => {
      context.assertCurrent(); context.signal.throwIfAborted();
      calls.push({ action, value, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId, caseOperationId: context.caseOperationId });
      return { content: [{ type: 'text', text: 'SYNTHETIC_RELATION_REVISION_V1' }], details: { type: 'optracall.case-relation-result', action } };
    } });
    const name = nested ? 'save_case_relation' : 'read_case_relations';
    f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '关系为明确声明，效果未知。' } : {
      calls: [{ name: nested ? 'codemode' : name, arguments: nested ? { code: `text(await tools.${name}(${JSON.stringify(input)}));` } : input }],
    });
    const opened = await agent.open(), requestId = randomUUID(), operationId = randomUUID();
    const run = agent.start('按需核对事项关系。', requestId, undefined, { case: { operationId } });
    await run.accepted; assert.equal((await run.completion).outcome, 'completed');
    assert.equal(calls.length, 1); assert.equal(calls[0].action, nested ? 'save' : 'read'); assert.deepEqual(calls[0].value, input);
    assert.equal(calls[0].requestId, requestId); assert.equal(calls[0].sessionId, opened.sessionId); assert.equal(calls[0].caseOperationId, operationId); assert.ok(calls[0].toolCallId);
    const native = await readFile((await agent.snapshot()).sessionFile!, 'utf8');
    assert.ok(native.includes(nested ? 'codemode' : 'read_case_relations'));
    assert.ok(JSON.stringify(f.provider.requests.at(-1)?.body.messages).includes('SYNTHETIC_RELATION_REVISION_V1'));
  });
});

test('SM07/A04 unbound and zero-call prompts remain ordinary; model arguments cannot supply a target owner', async t => {
  const f = await fixture(t); let calls = 0;
  const agent = f.create({ caseRelations: async () => { calls++; return { content: [{ type: 'text', text: 'should not be called' }], details: {} }; } });
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '无需先创建关系。' } : { calls: [{ name: 'read_case_relations', arguments: {} }] });
  assert.equal((await agent.start('没有Case绑定也能普通分析。', randomUUID()).completion).outcome, 'completed');
  assert.equal(calls, 0);
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '拒绝伪造目标。' } : { calls: [{ name: 'save_case_relation', arguments: {
    fromCaseId: randomUUID(), toCaseId: randomUUID(), kind: 'follows_up', expectedRelationRevision: 0, explanation: '模型不能授予owner。',
  } }] });
  assert.equal((await agent.start('不可指定别的目标Case。', randomUUID(), undefined, { case: { operationId: randomUUID() } }).completion).outcome, 'completed');
  assert.equal(calls, 0, 'the public schema must reject a model-provided toCaseId before any Host callback');
  f.provider.setResponder(() => ({ text: '零条关系也能回答。' }));
  assert.equal((await agent.start('正常零调用。', randomUUID(), undefined, { case: { operationId: randomUUID() } }).completion).outcome, 'completed');
  assert.equal(calls, 0);
});

test('SM09 relationship input shares the original IPC budget and rejects oversized model data before Host dispatch', async t => {
  const f = await fixture(t); let calls = 0;
  const agent = f.create({ caseRelations: async () => { calls++; return { content: [{ type: 'text', text: 'oversized input must not reach Host' }], details: {} }; } });
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '输入超出工具预算，保留缺口。' } : { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: 'x'.repeat(66 * 1024), kind: 'follows_up', expectedRelationRevision: 0 } }] });
  assert.equal((await agent.start('拒绝超出预算的模型输入。', randomUUID(), undefined, { case: { operationId: randomUUID() } }).completion).outcome, 'completed');
  assert.equal(calls, 0);
  assert.ok(JSON.stringify(f.provider.requests.at(-1)?.body.messages).includes('case_relation_payload_limit'));
});

test('SM10/A04 plugin, sealed, source-only, managed and no-task resources gain no relationship tools', { timeout: 60_000 }, async t => {
  const f = await fixture(t), caseRelations = async () => ({ content: [{ type: 'text' as const, text: 'unavailable' }], details: {} });
  const workspace = { cwd: path.join(f.options.projectDirectory, '020_clean'), systemPrompt: ['Synthetic closed resource.'] };
  for (const extra of [{ taskId: undefined }, { workspace }, ...(['fixed-draft', 'text-only', 'source-reader'] as const).map(capabilityPolicy => ({ workspace: { ...workspace, capabilityPolicy } }))]) {
    const opened = await f.create({ ...extra, caseRelations, sessionDirectory: path.join(f.root, randomUUID()) }).open();
    assert.ok(!opened.tools.includes('read_case_relations')); assert.ok(!opened.tools.includes('save_case_relation'));
  }
  for (const profile of ['ordinary', 'protected'] as const) {
    const agent = f.create({ caseRelations, protectedExecution: { id: randomUUID(), profile, cwd: workspace.cwd, writableRoot: workspace.cwd, readRoots: [] }, sessionDirectory: path.join(f.root, randomUUID()) });
    if (process.platform === 'darwin') {
      const opened = await agent.open(); assert.ok(!opened.tools.includes('read_case_relations')); assert.ok(!opened.tools.includes('save_case_relation'));
    } else {
      await assert.rejects(agent.open(), error => { assert.ok(error instanceof ProjectRuntimeError); assert.equal(error.code, 'sdk_operation_failed'); return true; });
    }
  }
  assert.equal(f.provider.requests.length, 0, 'capability inspection cannot call the Provider');
});

test('SM12/A04 cancellation revokes a deferred relationship save without a late commit or replay', { timeout: 30_000 }, async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void, denied = false, commits = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const agent = f.create({ caseRelations: async (_action, _input, context) => {
    entered(); await new Promise<void>(resolve => { release = resolve; });
    try { context.assertCurrent(); } catch (error) { denied = true; throw error; }
    commits++; return { content: [{ type: 'text', text: 'LATE_RELATION_COMMIT_MUST_NOT_APPEAR' }], details: {} };
  } });
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'done' } : { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: randomUUID(), kind: 'follows_up', expectedRelationRevision: 0, explanation: '尚未提交的合成关系。' } }] });
  const run = agent.start('停止前的合成关系。', randomUUID(), undefined, { case: { operationId: randomUUID() } });
  await waiting; const stopping = agent.stop(); await new Promise(resolve => setTimeout(resolve, 20)); release(); await stopping;
  assert.equal((await run.completion).outcome, 'cancelled'); assert.equal(denied, true); assert.equal(commits, 0);
  assert.ok(!(await readFile((await agent.snapshot()).sessionFile!, 'utf8')).includes('LATE_RELATION_COMMIT_MUST_NOT_APPEAR'));
});

test('SM12/A04 expired public SDK caller context cannot save during a later run; current nested calls remain usable', { timeout: 30_000 }, async t => {
  const f = await fixture(t), extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  const input = { fromCaseId: randomUUID(), kind: 'follows_up', expectedRelationRevision: 0, explanation: '当前调用的明确声明。' };
  await writeFile(path.join(extensions, 'relation-context.ts'), `export default pi=>{const parameters={type:'object',properties:{},additionalProperties:false};pi.registerTool({name:'capture_relation_ctx',label:'Capture',description:'Synthetic only',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{globalThis.__relationCtx=ctx;return{content:[{type:'text',text:'captured'}],details:{}};}});pi.registerTool({name:'reuse_relation_ctx',label:'Reuse',description:'Synthetic only',parameters,execute:async(_id,_args,signal)=>{const value=await globalThis.__relationCtx.executeTool('save_case_relation',${JSON.stringify(input)},{signal});return{content:[{type:'text',text:JSON.stringify(value)}],details:{}};}});};`);
  let step = 0, calls = 0;
  const plan = [{ calls: [{ name: 'capture_relation_ctx', arguments: {} }] }, { text: 'captured' }, { calls: [{ name: 'reuse_relation_ctx', arguments: {} }] }, { text: 'old caller rejected' }, { calls: [{ name: 'codemode', arguments: { code: `text(await tools.save_case_relation(${JSON.stringify(input)}));` } }] }, { text: 'current completed' }];
  f.provider.setResponder(() => plan[step++] ?? { text: 'done' });
  const agent = f.create({ caseRelations: async () => { calls++; return { content: [{ type: 'text', text: 'CURRENT_RELATION_ONLY' }], details: {} }; } });
  const provided = { case: { operationId: randomUUID() } };
  for (let i = 0; i < 2; i++) assert.equal((await agent.start('旧调用资格' + i, randomUUID(), undefined, provided).completion).outcome, 'completed');
  assert.equal(calls, 0);
  assert.equal((await agent.start('本轮合法嵌套。', randomUUID(), undefined, provided).completion).outcome, 'completed'); assert.equal(calls, 1);
});
