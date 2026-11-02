import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }

test('SIM-AGENT-01: task-enabled simulation tools run through the unified SDK runtime', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'sim合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-sim-model', apiKey: 'synthetic-sim-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Sim合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '推演任务', simulationTools: true }), 201);

  provider.setResponder(context => {
    if (context.requestNumber === 1) return { calls: [{ name: 'simulation_inspect', arguments: {} }] };
    if (context.requestNumber === 2) return { calls: [{ name: 'simulation_draft', arguments: { action: 'create', name: 'Agent 全流程草稿' } }] };
    if (context.requestNumber === 3) {
      const envelopes = context.recentToolResults.map(message => providerMessageText(message.content)).filter(Boolean).map(text => JSON.parse(text));
      const draftId = envelopes.map(value => value?.data?.draft?.id).find(Boolean);
      assert.ok(draftId, 'draft id must come back through the real tool result envelope');
      return { calls: [{ name: 'simulation_run', arguments: { draftId } }] };
    }
    return { text: '合成总结：已创建草稿并完成推演。' };
  });
  const requestId = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '请用推演工具创建草稿并运行', requestId }), 202);
  await provider.waitForRequests(4, 45_000);
  const deadline = Date.now() + 45_000;
  let finalTask;
  for (;;) {
    finalTask = (await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task;
    if (finalTask.lastRun?.status === 'completed') break;
    if (Date.now() > deadline) assert.fail(`Agent flow did not settle: ${JSON.stringify(finalTask.lastRun)}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(finalTask.lastRun.id, requestId);

  const toolNames = new Set(provider.requests.flatMap(record => (record.body.tools ?? []).map(tool => tool.function?.name ?? '')));
  for (const name of ['simulation_inspect', 'simulation_draft', 'simulation_run', 'simulation_stress', 'simulation_evidence']) {
    assert.ok(toolNames.has(name), `unified runtime must expose ${name}; got ${[...toolNames].join(',')}`);
  }
  assert.ok(!toolNames.has('simulation_freeze'), 'freeze must never be an agent tool');

  const drafts = await json(await host.request(`/api/simlab/projects/${project.id}/drafts`));
  assert.equal(drafts.drafts.length, 1);
  assert.equal(drafts.drafts[0].name, 'Agent 全流程草稿');
  const runs = await json(await host.request(`/api/simlab/projects/${project.id}/drafts/${drafts.drafts[0].id}/runs`));
  assert.equal(runs.runs.length, 1);
  for (const result of Object.values(runs.runs[0].results) as any[]) assert.equal(result.conservation, true);

  // 未开启工具的任务不暴露推演工具。
  const { task: plainTask } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '未开启推演的任务' }), 201);
  provider.setResponder(() => ({ text: '普通任务回复' }));
  const plainRequest = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${plainTask.id}/messages`, 'POST', { text: '普通问题', requestId: plainRequest }), 202);
  await provider.waitForRequests(5, 45_000);
  const plainTools = new Set((provider.requests.at(-1)!.body.tools ?? []).map(tool => tool.function?.name ?? ''));
  assert.ok(![...plainTools].some(name => name.startsWith('simulation_')), 'simulation tools must be opt-in per task');
});
