import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import type { TaskServiceBindings } from '../src/host/service-connection-types.ts';
import { createServiceConnectionTools, type ServiceConnectionsPort } from '../src/agent/service-connection-tools.ts';

const bindings: TaskServiceBindings = { github: {
  service: 'github', connectionId: 'connection-github', accountId: 'github:123', accountLabel: 'synthetic-user', revision: 1,
  scopes: ['read'], repositories: ['test/repository'], tools: [{ name: 'get_issue', semanticName: 'get_issue', scope: 'read', action: 'read', write: false, requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, issue_number: { type: 'integer' } }, required: ['owner','repo','issue_number'], additionalProperties: false } }],
} };

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-service-runtime-'));
  const projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources');
  for (const dir of ['010_draw','020_clean','060_reports']) await mkdir(path.join(projectDirectory, dir), { recursive: true });
  await mkdir(resourceRoot); await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider(), agents: ProjectAgent[] = [];
  const options: ProjectAgentOptions = { projectId: 'service-project', taskId: 'service-task', projectDirectory, resourceRoot, sessionDirectory: path.join(root, 'sessions'), codeRoot: process.cwd(), managementPorts: [], configuration: {
    id: 'service-synthetic', revision: 1, name: 'Service protocol fixture', provider: 'synthetic', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'service-synthetic', apiKey: 'synthetic-service-only',
  } };
  const create = (overrides: Partial<ProjectAgentOptions> & Record<string, unknown> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); await rm(root, { recursive: true, force: true }); });
  return { root, create, provider, options };
}

test('service tools require a current explicit grant and are registered through the existing real Pi task', async t => {
  const f = await fixture(t);
  const agent = f.create({ serviceBindings: bindings, serviceConnections: { call: async () => ({ content: [{ type: 'text', text: 'synthetic-source' }], details: {} }) } });
  const snapshot = await agent.open();
  assert.ok(snapshot.tools.includes('service_github_get_issue'));
  assert.equal(f.provider.requests.length, 0, 'opening does not run a provider or service request');
});

test('real Pi direct and nested calls preserve the task, original invocation, precise schema and saved history', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const f = await fixture(t), calls: Parameters<ServiceConnectionsPort['call']>[] = [];
    const args = { owner: 'test', repo: 'repository', issue_number: 145 };
    f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'Synthetic connection completed.' } : { calls: [nested ? {
      name: 'codemode', arguments: { code: `text(await tools.service_github_get_issue(${JSON.stringify(args)}));` },
    } : { name: 'service_github_get_issue', arguments: args }] });
    const agent = f.create({ serviceBindings: bindings, serviceConnections: { call: async (input, context) => {
      context.assertCurrent(); calls.push([input, context]);
      return { content: [{ type: 'text', text: 'SYNTHETIC_EXACT_ISSUE_145' }], details: { source: 'test/repository', complete: true } };
    } } satisfies ServiceConnectionsPort });
    const opened = await agent.open(), requestId = `service-${nested ? 'nested' : 'direct'}`;
    const result = await agent.start('Read the synthetic approved issue.', requestId).completion;
    assert.equal(result.outcome, 'completed'); assert.equal(calls.length, 1);
    const [input, context] = calls[0]!;
    assert.deepEqual(input, { service: 'github', toolName: 'get_issue', args });
    assert.equal(context.projectId, 'service-project'); assert.equal(context.taskId, 'service-task'); assert.equal(context.requestId, requestId); assert.equal(context.sessionId, opened.sessionId);
    assert.ok(context.toolCallId); assert.equal(typeof context.registerCleanup, 'function'); assert.equal(typeof context.confirm, 'function');
    assert.throws(context.assertCurrent, /service_connection_run_unavailable/);
    const snapshot = await agent.snapshot();
    assert.match(JSON.stringify(snapshot.messages), /SYNTHETIC_EXACT_ISSUE_145/);
    await agent.close();
    const restored = await f.create({ sessionFile: snapshot.sessionFile }).open();
    assert.ok(!restored.tools.some(name => name.startsWith('service_')), 'native history does not mint account grants');
    assert.match(JSON.stringify(restored.messages), /SYNTHETIC_EXACT_ISSUE_145/);
    assert.equal(f.provider.errors.length, 0);
  });
});

test('service schemas fail closed, narrowing survives metadata mutation and credentials never reach dispatch', async () => {
  let calls = 0;
  const mutable = structuredClone(bindings);
  const tools = createServiceConnectionTools(mutable, async () => { calls++; return { content: [], details: {} }; });
  mutable.github!.tools[0]!.inputSchema.additionalProperties = true;
  const tool = tools[0]!, signal = new AbortController().signal;
  for (const invalid of [
    { owner: 'test', repo: 'repository', issue_number: 145, confirmed: true },
    { owner: 'test', repo: 'repository', issue_number: '145' },
    { owner: 'test', repo: 'repository', issue_number: 145, accessToken: 'forbidden-secret' },
    { owner: 'test', repo: 'repository', issue_number: 145, nested: { clientSecret: 'forbidden-secret' } },
  ]) await assert.rejects(tool.execute('call', invalid, signal, undefined, {}));
  await assert.rejects(tool.execute('call', { owner: 'test', repo: 'repository', issue_number: 145 }), /service_connection_run_unavailable/);
  await assert.rejects(tool.execute('call', { owner: 'test', repo: 'repository', issue_number: 145 }, AbortSignal.abort(), undefined, {}), { name: 'AbortError' });
  assert.equal(calls, 0);
  assert.deepEqual(createServiceConnectionTools(undefined, async () => assert.fail()), []);
});

test('original fixed profiles and business workspaces never acquire personal service tools', async t => {
  const f = await fixture(t);
  for (const capabilityPolicy of [undefined, 'fixed-draft', 'text-only', 'source-reader', 'public-search', 'strategy-discussion', 'strategy-initiative'] as const) {
    const agent = f.create({ serviceBindings: bindings, serviceConnections: { call: async () => assert.fail('workspace cannot dispatch service calls') }, workspace: {
      cwd: path.join(f.options.projectDirectory!, '020_clean'), systemPrompt: ['Synthetic restricted workspace.'], defaultTools: [], ...(capabilityPolicy ? { capabilityPolicy } : {}),
    } });
    const opened = await agent.open(); assert.ok(!opened.tools.some(name => name.startsWith('service_')), String(capabilityPolicy)); await agent.close();
  }
});

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) { const value = read(); if (value !== undefined) return value; if (Date.now() > end) throw new Error('Synthetic service condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('trusted confirmation uses the original browser dialog and an exact current tool invocation', async t => {
  for (const confirmed of [true, false]) await t.test(confirmed ? 'approved' : 'declined', async t => {
    const f = await fixture(t); let dispatched = 0;
    f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'Synthetic action settled.' } : { calls: [{ name: 'service_github_get_issue', arguments: { owner: 'test', repo: 'repository', issue_number: 145 } }] });
    const agent = f.create({ serviceBindings: bindings, serviceConnections: { call: async (_input, context) => {
      const approved = await context.confirm('确认准确操作', '账号 synthetic-user；目标 test/repository#145；固定内容 exact-content。');
      context.assertCurrent(); if (approved) dispatched++;
      return { content: [{ type: 'text', text: approved ? 'SYNTHETIC_APPROVED' : 'SYNTHETIC_DECLINED' }], details: { dispatched: approved } };
    } } satisfies ServiceConnectionsPort });
    const started = agent.start('Run the synthetic confirmation test.', `service-confirm-${confirmed}`);
    const question = await waitFor(() => agent.pendingUI[0]);
    assert.equal(question.requestId, `service-confirm-${confirmed}`); assert.equal(question.request.method, 'confirm'); assert.match(question.request.message!, /exact-content/);
    assert.equal(agent.busy, true); assert.equal(dispatched, 0);
    assert.equal((await agent.respondUI({ id: question.request.id, value: confirmed })).accepted, true);
    assert.equal((await started.completion).outcome, 'completed'); assert.equal(dispatched, confirmed ? 1 : 0); assert.equal(agent.pendingUI.length, 0);
  });
});

test('cancel while awaiting approval dismisses it, closes this call and prevents late dispatch or replay', async t => {
  const f = await fixture(t); let dispatched = 0, cleanup = 0;
  f.provider.setResponder(() => ({ calls: [{ name: 'service_github_get_issue', arguments: { owner: 'test', repo: 'repository', issue_number: 145 } }] }));
  const agent = f.create({ serviceBindings: bindings, serviceConnections: { call: async (_input, context) => {
    context.registerCleanup(async () => { cleanup++; });
    if (await context.confirm('确认发送', 'Synthetic exact content.')) { context.assertCurrent(); dispatched++; }
    return { content: [], details: {} };
  } } satisfies ServiceConnectionsPort });
  const started = agent.start('Wait for synthetic approval.', 'cancel-approval');
  const question = await waitFor(() => agent.pendingUI[0]);
  await agent.stop();
  assert.equal((await started.completion).outcome, 'cancelled'); assert.equal(agent.pendingUI.length, 0);
  assert.equal((await agent.respondUI({ id: question.request.id, value: true })).accepted, false);
  assert.equal(dispatched, 0); assert.equal(cleanup, 1); assert.equal(f.provider.requests.length, 1);
});

test('retaining a completed Host callback cannot dispatch while the same original model turn remains active', async t => {
  const f = await fixture(t); let retained: Parameters<ServiceConnectionsPort['call']>[1] | undefined;
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { hold: true } : { calls: [{ name: 'service_github_get_issue', arguments: { owner: 'test', repo: 'repository', issue_number: 145 } }] });
  const agent = f.create({ serviceBindings: bindings, serviceConnections: { call: async (_input, context) => {
    retained = context; context.assertCurrent(); return { content: [{ type: 'text', text: 'Synthetic read completed.' }], details: {} };
  } } satisfies ServiceConnectionsPort });
  const started = agent.start('Read the exact synthetic source.', 'retained-callback');
  await f.provider.waitForRequests(2);
  assert.equal(agent.busy, true); assert.ok(retained);
  assert.throws(retained.assertCurrent, /service_connection_run_unavailable/);
  await assert.rejects(retained.confirm('Late confirmation', 'Must never appear.'), /service_connection_run_unavailable/);
  assert.equal(agent.pendingUI.length, 0);
  await agent.stop(); assert.equal((await started.completion).outcome, 'cancelled');
});

test('service cleanup uncertainty retains the original owner and only explicit cleanup retry can release it', async t => {
  const f = await fixture(t); let calls = 0, cleanup = 0;
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'Original resource cleanup remains UNKNOWN.' } : { calls: [{ name: 'service_github_get_issue', arguments: { owner: 'test', repo: 'repository', issue_number: 145 } }] });
  const agent = f.create({ serviceBindings: bindings, serviceConnections: { call: async (_input, context) => {
    calls++;
    context.registerCleanup(async options => { cleanup++; if (!options.retryFailed) throw new Error('synthetic-service-cleanup-unknown'); });
    return { content: [{ type: 'text', text: 'UNCLOSED_SERVICE_RESULT_MUST_NOT_DELIVER' }], details: {} };
  } } satisfies ServiceConnectionsPort });
  await assert.rejects(agent.start('Read the exact synthetic source.', 'service-cleanup-unknown').completion, /semantic_context_cleanup_unknown/);
  assert.equal(agent.busy, true); assert.equal(calls, 1); assert.equal(cleanup, 1);
  assert.ok(!f.provider.requests.some(request => JSON.stringify(request.body.messages).includes('UNCLOSED_SERVICE_RESULT_MUST_NOT_DELIVER')));
  await assert.rejects(agent.stop(), /semantic_context_cleanup_unknown/); assert.equal(cleanup, 1);
  await assert.rejects(agent.close({ retryFailed: false }), /semantic_context_cleanup_unknown/); assert.equal(cleanup, 1);
  await agent.close({ retryFailed: true }); assert.equal(cleanup, 2); assert.equal(calls, 1); assert.equal(agent.busy, false);
});
