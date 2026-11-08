import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { freezeSuggestionFor } from '../extensions/business-plugins/sim-lab/ui/task-suggestions.ts';

async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function settled(host: Awaited<ReturnType<typeof startTestHost>>, route: string, requestId: string) {
  const deadline = Date.now() + 45_000;
  for (;;) {
    const state = await json(await host.request(route));
    if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running') {
      assert.equal(state.task.lastRun.status, 'completed');
      if (state.snapshot.status === 'idle') return state;
    }
    if (Date.now() > deadline) assert.fail(`Agent flow did not settle: ${JSON.stringify(state.task.lastRun)}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

test('SIM-AGENT-01: task-enabled simulation tools run through the unified SDK runtime', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'sim合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-sim-model', apiKey: 'synthetic-sim-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Sim合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '推演任务', simulationTools: true }), 201);

  provider.setResponder(context => {
    if (context.requestNumber === 1) return { calls: [{ name: 'simulation_inspect', arguments: {} }] };
    if (context.requestNumber === 2) return { calls: [{ name: 'simulation_draft', arguments: { action: 'create', name: 'Agent 全流程草稿' } }] };
    if (context.requestNumber === 3 || context.requestNumber === 4) {
      const envelopes = context.recentToolResults.map(message => providerMessageText(message.content)).filter(Boolean).map(text => JSON.parse(text));
      const draftId = envelopes.map(value => value?.data?.draft?.id).find(Boolean);
      assert.ok(draftId, 'draft id must come back through the real tool result envelope');
      return { calls: [{ name: context.requestNumber === 3 ? 'simulation_run' : 'simulation_stress', arguments: { draftId, ...(context.requestNumber === 4 ? { perturbation: { demandMultiplier: 1.25 } } : { suggestFreeze: { variantId: 'baseline', reason: '合成Agent建议：请用户核对后固化基线。' } }) } }] };
    }
    if (context.requestNumber === 5) return { calls: [{ name: 'simulation_evidence', arguments: {} }] };
    return { text: '合成总结：已创建草稿并完成推演。' };
  });
  const requestId = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '请用推演工具创建草稿并运行', requestId }), 202);
  await provider.waitForRequests(6, 45_000);
  const { task: finalTask, snapshot: initialSnapshot } = await settled(host, `/api/projects/${project.id}/tasks/${task.id}`, requestId);
  assert.equal(finalTask.lastRun.id, requestId);

  const toolNames = new Set(provider.requests.flatMap(record => (record.body.tools ?? []).map(tool => tool.function?.name ?? '')));
  for (const name of ['simulation_inspect', 'simulation_draft', 'simulation_run', 'simulation_stress', 'simulation_evidence']) {
    assert.ok(toolNames.has(name), `unified runtime must expose ${name}; got ${[...toolNames].join(',')}`);
  }
  assert.ok(!toolNames.has('simulation_freeze'), 'freeze must never be an agent tool');
  for (const name of ['read', 'bash', 'edit', 'write']) assert.ok(toolNames.has(name), `opt-in simulation must retain ordinary ${name}`);
  const executed = provider.requests.at(-1)!.body.messages!.filter(message => message.role === 'tool').map(message => JSON.parse(providerMessageText(message.content)));
  assert.equal(executed.length, 5, 'all five tools must actually execute through the SDK');
  for (const envelope of executed) assert.equal(envelope.status, 'succeeded');
  const suggestions = initialSnapshot.messages.map((_message: unknown, index: number) => freezeSuggestionFor(initialSnapshot.messages, index, project.id)).filter(Boolean);
  assert.equal(suggestions.length, 1, 'the actual SDK tool call/result produces one explicit suggestion card');
  assert.equal(suggestions[0].variantId, 'baseline');

  const drafts = await json(await host.request(`/api/simlab/projects/${project.id}/drafts`));
  assert.equal(drafts.drafts.length, 1);
  assert.equal(drafts.drafts[0].name, 'Agent 全流程草稿');
  const runs = await json(await host.request(`/api/simlab/projects/${project.id}/drafts/${drafts.drafts[0].id}/runs`));
  assert.equal(runs.runs.length, 1);
  for (const result of Object.values(runs.runs[0].results) as any[]) assert.equal(result.conservation, true);
  const { snapshot } = await json(await host.request(`/api/simlab/projects/${project.id}/drafts/${drafts.drafts[0].id}/freeze`, 'POST', { runId: runs.runs[0].id, variantId: 'baseline', expectedRevision: 1 }), 201);
  provider.setResponder(context => context.recentToolResults.length ? { text: '已读用户固化回执' } : { calls: [{ name: 'simulation_evidence', arguments: { snapshotId: snapshot.id } }] });
  const evidenceRequest = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '读取用户固化的快照回执', requestId: evidenceRequest }), 202);
  await settled(host, `/api/projects/${project.id}/tasks/${task.id}`, evidenceRequest);
  const receipt = JSON.parse(providerMessageText(provider.requests.at(-1)!.body.messages!.filter(message => message.role === 'tool').at(-1)!.content));
  assert.equal(receipt.data.snapshot.id, snapshot.id);

  // 未开启工具的任务不暴露推演工具。
  const { task: plainTask } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '未开启推演的任务' }), 201);
  provider.setResponder(() => ({ text: '普通任务回复' }));
  const plainRequest = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${plainTask.id}/messages`, 'POST', { text: '普通问题', requestId: plainRequest }), 202);
  await settled(host, `/api/projects/${project.id}/tasks/${plainTask.id}`, plainRequest);
  const plainTools = new Set((provider.requests.at(-1)!.body.tools ?? []).map(tool => tool.function?.name ?? ''));
  assert.ok(![...plainTools].some(name => name.startsWith('simulation_')), 'simulation tools must be opt-in per task');
});

test('SIM-AGENT-02: task switch retires idle resources, preserves history and rejects changes during a turn', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'sim合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-sim-model', apiKey: 'synthetic-sim-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '开关合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '旧普通任务' }), 201);
  assert.equal(task.simulationTools, undefined, 'old schema2 metadata needs no new field');
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const first = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '普通回复', requestId: first }), 202);
  const original = await settled(host, route, first), nativeFile = original.task.sessionFile;
  const prefix = await readFile(nativeFile);
  await json(await host.request(route + '/simulation-tools', 'PUT', { enabled: true }));
  const enabled = await json(await host.request(route + '/open', 'POST', {}));
  assert.ok(enabled.snapshot.tools.includes('simulation_run'), 'next open must apply enabled tools to an existing conversation');
  assert.equal(enabled.task.sessionFile, nativeFile);
  assert.ok((await readFile(nativeFile)).subarray(0, prefix.length).equals(prefix));
  await json(await host.request(route + '/simulation-tools', 'PUT', { enabled: false }));
  const disabled = await json(await host.request(route + '/open', 'POST', {}));
  assert.ok(!disabled.snapshot.tools.some((name: string) => name.startsWith('simulation_')));
  assert.equal(disabled.task.sessionFile, nativeFile);
  provider.setResponder(() => ({ text: 'held', hold: true }));
  const active = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '保持在途', requestId: active }), 202);
  await provider.waitForRequests(2);
  assert.equal((await json(await host.request(route + '/simulation-tools', 'PUT', { enabled: true }), 409)).code, 'session_busy');
  assert.equal((await json(await host.request(route))).task.simulationTools, undefined);
  await json(await host.request(route + '/stop', 'POST', {}));
});
