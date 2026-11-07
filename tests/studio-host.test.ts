import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

async function json(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

test('ST03: the real Host lists an empty Studio without creating projects or starting a model', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const before = await json(await host.request('/api/projects'));
  assert.deepEqual(await json(await host.request('/api/studio/systems')), { systems: [] });
  assert.deepEqual(await json(await host.request('/api/projects')), before);
});

test('ST07/14: the existing project Pi session autonomously reads its bound Studio through a real tool turn', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Studio synthetic tools', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-studio-tools', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Studio synthetic tool owner' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), name: 'Source-bound retail', projectId: project.id, goal: 'Build sales/refund assets from approved material', topicTitle: 'Sales and refunds' }), 201);
  provider.setResponder(context => {
    if (!context.availableTools.includes('studio_assets')) return { text: 'STUDIO_TOOL_NOT_CONNECTED' };
    if (!context.recentToolResults.length) return { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] };
    const receipt = providerMessageText(context.recentToolResults[0].content);
    assert.match(receipt, /Source-bound retail/);
    return { text: 'STUDIO_BOUND_TOOL_RESULT_READ' };
  });
  const route = `/api/projects/${project.id}/tasks/${system.taskId}`;
  const requestId = randomUUID(), text = 'Read the saved Studio context and continue autonomously.';
  await json(await host.request(`${route}/messages`, 'POST', { requestId, text, studioContext: { systemId: system.id, purpose: 'construction' } }), 202);
  const started = Date.now(); let state: any;
  do { state = await json(await host.request(route)); if (state.task.lastRun?.status === 'completed' && state.snapshot.status === 'idle') break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() - started < 30_000);
  assert.equal(state.task.lastRun?.status, 'completed');
  assert.match(JSON.stringify(state.snapshot.messages), /STUDIO_BOUND_TOOL_RESULT_READ/);
  assert.ok(state.snapshot.messages.some((message: any) => message.role === 'toolResult'));
  assert.deepEqual(provider.errors, []);
  const changedSelection = await host.request(`${route}/messages`, 'POST', { requestId, text, studioContext: { systemId: system.id, purpose: 'analysis' } });
  assert.equal(changedSelection.status, 409, 'An accepted request cannot silently change its exact Studio selection.');
});

test('ST02/18: starting a Studio uses one real project task and its exact operation receipt prevents duplicates', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Studio synthetic', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-studio', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Studio synthetic construction' }), 201);
  const input = { requestId: randomUUID(), name: 'Synthetic retail system', projectId: project.id, goal: 'Store payment and refund amounts and period comparison', topicTitle: 'Sales and refunds', materials: [] };
  const created = await json(await host.request('/api/studio/systems', 'POST', input), 201);
  const workspace = await json(await host.request(`/api/studio/systems/${created.system.id}`));
  assert.equal(workspace.system.projectId, project.id);
  assert.equal(workspace.task.id, created.system.taskId);
  assert.equal(workspace.running, false);
  assert.equal(workspace.system.assets.length, 0, 'No model ran and no business source was fabricated.');
  const receipt = await json(await host.request(`/api/studio/operations/${input.requestId}`));
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.systemId, created.system.id);
  const repeated = await json(await host.request('/api/studio/systems', 'POST', input), 201);
  assert.equal(repeated.system.id, created.system.id);
  const { projects } = await json(await host.request('/api/projects'));
  assert.equal(projects.find((item: any) => item.id === project.id).tasks.length, 1);
  const conflict = await host.request('/api/studio/systems', 'POST', { ...input, name: 'Different payload' });
  assert.equal(conflict.status, 409);
});

test('Studio graph unavailable fails before dispatch and leaves independent source work usable', async t => {
 const host=await startTestHost(); t.after(()=>host.close());
 await json(await host.request('/api/configuration','PUT',{name:'Studio graph unavailable',provider:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-studio',apiKey:'synthetic-only'}));
 const {project}=await json(await host.request('/api/projects','POST',{name:'合成图环境缺失'}),201);
 const {system}=await json(await host.request('/api/studio/systems','POST',{requestId:randomUUID(),name:'合成体系',projectId:project.id,goal:'退款',topicTitle:'销售退款'}),201);
 const requestId=randomUUID(); await json(await host.request(`/api/studio/systems/${system.id}/graph-refresh`,'POST',{requestId}),409);
 const receipt=await json(await host.request(`/api/studio/operations/${requestId}`)); assert.equal(receipt.status,'failed'); assert.equal(receipt.error,'studio_semantica_unavailable');
 const saved=await json(await host.request(`/api/studio/systems/${system.id}`)); assert.deepEqual(saved.system.graphs,[]); assert.equal(saved.running,false);
});

test('Studio graph with no eligible formal sources records a known preparation failure instead of permanent UNKNOWN', {skip:!process.env.OPTRACALL_STUDIO_TEST_PYTHON}, async t => {
 const host=await startTestHost({studioPython:process.env.OPTRACALL_STUDIO_TEST_PYTHON}); t.after(()=>host.close());
 await json(await host.request('/api/configuration','PUT',{name:'Studio no source',provider:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-studio',apiKey:'synthetic-only'}));
 const {project}=await json(await host.request('/api/projects','POST',{name:'合成未发布'}),201);
 const {system}=await json(await host.request('/api/studio/systems','POST',{requestId:randomUUID(),name:'合成体系',projectId:project.id,goal:'退款',topicTitle:'销售退款'}),201);
 const requestId=randomUUID(); await json(await host.request(`/api/studio/systems/${system.id}/graph-refresh`,'POST',{requestId}),409);
 const receipt=await json(await host.request(`/api/studio/operations/${requestId}`)); assert.equal(receipt.status,'failed'); assert.equal(receipt.error,'studio_graph_no_eligible_sources');
 const saved=await json(await host.request(`/api/studio/systems/${system.id}`)); assert.deepEqual(saved.system.graphs.map((g:any)=>g.status),['unknown','failed']); assert.equal(saved.running,false);
});

test('an unavailable historical graph selection is a known failed read check and never changes the selected graph', async t => {
 const host=await startTestHost(); t.after(()=>host.close());
 await json(await host.request('/api/configuration','PUT',{name:'Studio graph selection',provider:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-studio',apiKey:'synthetic-only'}));
 const {project}=await json(await host.request('/api/projects','POST',{name:'合成缺失快照'}),201);
 const {system}=await json(await host.request('/api/studio/systems','POST',{requestId:randomUUID(),name:'合成体系',projectId:project.id,goal:'退款',topicTitle:'销售退款'}),201);
 const requestId=randomUUID(); await json(await host.request(`/api/studio/systems/${system.id}/graph-selection`,'POST',{requestId,snapshotId:randomUUID()}),409);
 const receipt=await json(await host.request(`/api/studio/operations/${requestId}`)); assert.equal(receipt.status,'failed'); assert.equal(receipt.error,'studio_graph_selection_unavailable');
 assert.equal((await json(await host.request(`/api/studio/systems/${system.id}`))).system.selectedGraphSnapshotId,undefined);
});
