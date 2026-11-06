import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { writeModelPack } from './model-pack-fixtures.ts';

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text()); return response.json();
}
async function settled(host: Awaited<ReturnType<typeof startTestHost>>, route: string, requestId: string) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = await json(await host.request(route));
    if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running') {
      assert.equal(state.task.lastRun.status, 'completed', JSON.stringify(state.task.lastRun)); return state;
    }
    if (Date.now() > deadline) assert.fail(`Synthetic model task did not settle: ${JSON.stringify(state.task.lastRun)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('MP04: Host task capability defaults off, persists independently, and can only change while idle and unarchived', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic model capability', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model-capability', apiKey: 'synthetic-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Synthetic capability project' }), 201);
  const tasks = `/api/projects/${project.id}/tasks`;
  const { task: defaultTask } = await json(await host.request(tasks, 'POST', { name: 'Default task' }), 201);
  assert.equal(defaultTask.modelTools, undefined);
  const { task } = await json(await host.request(tasks, 'POST', { name: 'Enabled task', simulationTools: true, modelTools: true }), 201);
  assert.equal(task.modelTools, true); assert.equal(task.simulationTools, true);
  const route = `${tasks}/${task.id}`;
  assert.equal((await json(await host.request(route))).task.modelTools, true);
  const { task: disabled } = await json(await host.request(route + '/capabilities', 'PUT', { capability: 'modelTools', enabled: false }));
  assert.equal(disabled.modelTools, undefined); assert.equal(disabled.simulationTools, true);
  await json(await host.request(tasks, 'POST', { name: 'Invalid task', modelTools: 'true' }), 400);
  await json(await host.request(route + '/capabilities', 'PUT', { capability: 'modelTools', enabled: true }));
  provider.setResponder(() => ({ hold: true }));
  const requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: 'Hold synthetic capability operation.', requestId }), 202);
  await provider.waitForRequests(1);
  assert.equal((await json(await host.request(route + '/capabilities', 'PUT', { capability: 'modelTools', enabled: false }), 409)).code, 'session_busy');
  await json(await host.request(route + '/stop', 'POST', {}));
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.equal((await json(await host.request(route + '/capabilities', 'PUT', { capability: 'modelTools', enabled: false }), 409)).code, 'project_archived');
  assert.equal((await json(await host.request(route))).task.modelTools, true);
});

test('MP07: actual Host/Pi synthetic Provider discovers, prepares input, predicts, reads and cites a report; disabled task has no model tools', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  const sourcePath = await realpath(await writeModelPack(path.join(host.scratch, 'synthetic-source')));
  const imported = await json(await host.request('/api/model-pack/imports', 'POST', { sourcePath }));
  assert.equal(imported.model.stage, 'Staging');
  await json(await host.request('/api/model-pack/models/synthetic-model/1/promote', 'POST', {}));
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic model workflow', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model-workflow', apiKey: 'synthetic-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Synthetic model workflow' }), 201);
  const tasks = `/api/projects/${project.id}/tasks`;
  const { task: disabled } = await json(await host.request(tasks, 'POST', { name: 'Disabled model task' }), 201);
  provider.setResponder(context => {
    assert.deepEqual(context.availableTools.filter(name => name.startsWith('modelpack_')), []);
    return { text: 'No model capability enabled.' };
  });
  const disabledId = randomUUID();
  await json(await host.request(`${tasks}/${disabled.id}/messages`, 'POST', { text: 'Synthetic disabled capability check.', requestId: disabledId }), 202);
  await settled(host, `${tasks}/${disabled.id}`, disabledId);
  const { task } = await json(await host.request(tasks, 'POST', { name: 'Enabled model task', modelTools: true }), 201);
  const route = `${tasks}/${task.id}`, inputPath = path.join(project.rootPath, '020_clean/model-input.json');
  const reportPath = path.join(project.rootPath, '060_reports/model-report.md');
  let step = 0, discovered: { name: string; version: number } | undefined;
  let provenance: { name: string; version: number; stage: string; metrics: { mae: number }; fingerprint: { sha256: string } } | undefined;
  let report = '';
  provider.setResponder(context => {
    for (const name of ['modelpack_list', 'modelpack_predict', 'read', 'write']) assert.ok(context.availableTools.includes(name), name);
    const last = providerMessageText(context.recentToolResults.at(-1)?.content);
    if (step++ === 0) return { calls: [{ name: 'modelpack_list', arguments: {} }] };
    if (step === 2) {
      const shelf = JSON.parse(last); assert.equal(shelf.status, 'succeeded');
      discovered = shelf.data.models.find((model: { stage: string }) => model.stage === 'Production'); assert.ok(discovered);
      return { calls: [{ name: 'write', arguments: { path: inputPath, content: '[{"x":10},{"x":20}]' } }] };
    }
    if (step === 3) return { calls: [{ name: 'modelpack_predict', arguments: { name: discovered!.name, inputPath: '020_clean/model-input.json', outputPath: '060_reports/model-output.json' } }] };
    if (step === 4) {
      const prediction = JSON.parse(last); assert.equal(prediction.status, 'succeeded');
      provenance = prediction.data.provenance;
      return { calls: [{ name: 'read', arguments: { path: path.join(project.rootPath, prediction.data.outputPath) } }] };
    }
    if (step === 5) {
      const output = JSON.parse(last); assert.deepEqual(output.map((row: { prediction: number }) => row.prediction), [20, 40]);
      report = `# Synthetic forecast\nPredictions: ${output.map((row: { prediction: number }) => row.prediction).join(', ')}.\nSource: ${provenance!.name} v${provenance!.version} ${provenance!.stage}; MAE ${provenance!.metrics.mae}; fingerprint ${provenance!.fingerprint.sha256}.\n`;
      return { calls: [{ name: 'write', arguments: { path: reportPath, content: report } }] };
    }
    return { text: 'Synthetic forecast completed with model source recorded in 060_reports/model-report.md.' };
  });
  const requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: 'Forecast the synthetic rows, prepare any input needed, and save a report citing the model source.', requestId }), 202);
  const final = await settled(host, route, requestId);
  assert.equal(step, 6); assert.deepEqual(provider.errors, []);
  assert.equal(await readFile(reportPath, 'utf8'), report);
  assert.match(report, /20, 40/); assert.match(report, /synthetic-model v1 Production; MAE 0.25/); assert.ok(report.includes('a'.repeat(64)));
  const names = provider.requests.at(-1)!.body.messages!.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? []).map((call: any) => call.function?.name);
  assert.deepEqual(names, ['modelpack_list', 'write', 'modelpack_predict', 'read', 'write']);
  assert.deepEqual(final.snapshot.uiRequests ?? [], [], 'no per-call approval needed');
  assert.equal((await json(await host.request(route))).task.modelTools, true, 'saved task retains its optional capability');
  const nativeFile = final.task.sessionFile, prefix = await readFile(nativeFile), requests = provider.requests.length;
  for (const enabled of [false, true]) {
    await json(await host.request(route + '/capabilities', 'PUT', { capability: 'modelTools', enabled }));
    const reopened = await json(await host.request(route + '/open', 'POST', {}));
    assert.deepEqual(reopened.snapshot.tools.filter((name: string) => name.startsWith('modelpack_')).sort(), enabled ? ['modelpack_list', 'modelpack_predict'] : []);
    assert.equal(reopened.task.sessionFile, nativeFile);
    assert.ok((await readFile(nativeFile)).subarray(0, prefix.length).equals(prefix), 'reopening preserves the original native bytes and prediction receipt');
  }
  assert.equal(provider.requests.length, requests, 'switch/open must not replay a model request');
});

test('MP06/07: actual SDK returns the first prediction failure to the Agent, which independently fixes input without a required list call', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  const sourcePath = await realpath(await writeModelPack(path.join(host.scratch, 'synthetic-source')));
  await json(await host.request('/api/model-pack/imports', 'POST', { sourcePath }));
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic correction', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-correction', apiKey: 'synthetic-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Synthetic correction' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Explicit Staging correction', modelTools: true }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  let step = 0;
  const prediction = { name: 'synthetic-model', version: 1, inputPath: '020_clean/prepared.json', outputPath: '060_reports/recovered.json' };
  provider.setResponder(context => {
    const last = providerMessageText(context.recentToolResults.at(-1)?.content);
    if (step++ === 0) return { calls: [{ name: 'modelpack_predict', arguments: prediction }] };
    if (step === 2) {
      const failure = JSON.parse(last); assert.equal(failure.status, 'rejected');
      assert.match(failure.code, /INPUT|PATH/); assert.ok(failure.detail.reason);
      return { calls: [{ name: 'write', arguments: { path: path.join(project.rootPath, prediction.inputPath), content: '[{"x":7}]' } }] };
    }
    if (step === 3) return { calls: [{ name: 'modelpack_predict', arguments: prediction }] };
    const success = JSON.parse(last); assert.equal(success.status, 'succeeded'); assert.equal(success.data.provenance.stage, 'Staging');
    return { text: 'Synthetic input corrected; explicit Staging v1 prediction saved. First failure retained.' };
  });
  const requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: 'Use the named synthetic Staging v1 model; prepare missing input if needed.', requestId }), 202);
  await settled(host, route, requestId);
  assert.equal(step, 4); assert.deepEqual(provider.errors, []);
  const finalMessages = provider.requests.at(-1)!.body.messages!;
  const names = finalMessages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? []).map((call: any) => call.function?.name);
  assert.deepEqual(names, ['modelpack_predict', 'write', 'modelpack_predict'], 'the Provider chose correction; the Host did not retry or force discovery');
  const predictions = finalMessages.filter(message => message.role === 'tool').map(message => providerMessageText(message.content)).filter(text => text.startsWith('{')).map(text => JSON.parse(text)).filter(value => value.status);
  assert.deepEqual(predictions.map(value => value.status), ['rejected', 'succeeded'], 'both first failure and later success remain in actual SDK history');
  assert.deepEqual(JSON.parse(await readFile(path.join(project.rootPath, prediction.outputPath), 'utf8')), [{ x: 7, prediction: 14 }]);
});

test('MP04: actual SDK exposes both model tools only in an explicitly enabled ordinary project task', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-modelpack-injection-'));
  for (const enabled of [false, true]) {
    const projectDirectory = path.join(root, String(enabled), 'project');
    const sessionDirectory = path.join(root, String(enabled), 'sessions'), resourceRoot = path.join(root, String(enabled), 'resources');
    for (const directory of [path.join(projectDirectory, '020_clean'), path.join(projectDirectory, '060_reports'), sessionDirectory, resourceRoot]) await mkdir(directory, { recursive: true });
    const agent = new ProjectAgent({ projectId: randomUUID(), taskId: randomUUID(), projectDirectory, sessionDirectory, resourceRoot,
      codeRoot: process.cwd(), managementPorts: [], ...(enabled ? { modelPackTools: { modelsRoot: path.join(root, 'models') } } : {}),
      configuration: { id: randomUUID(), revision: 1, name: 'Synthetic only', provider: 'openai-compatible', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic-key' } });
    t.after(() => agent.close());
    const snapshot = await agent.open();
    assert.deepEqual(snapshot.tools.filter(name => name.startsWith('modelpack_')).sort(), enabled ? ['modelpack_list', 'modelpack_predict'] : []);
    for (const name of ['bash', 'read', 'write']) assert.ok(snapshot.tools.includes(name), `ordinary task retains ${name}`);
    await agent.close();
  }
});

test('MP04: actual SDK excludes saved model opt-in from every sealed/workspace and managed scope', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-modelpack-exclusions-'));
  const modes = ['fixed-draft', 'text-only', 'source-reader', 'workspace', ...(process.platform === 'darwin' ? ['ordinary', 'protected'] : [])];
  for (const mode of modes) {
    const projectDirectory = path.join(root, mode, 'project'), work = path.join(projectDirectory, '020_clean');
    const sessionDirectory = path.join(root, mode, 'sessions'), resourceRoot = path.join(root, mode, 'resources');
    for (const directory of [work, path.join(projectDirectory, '060_reports'), sessionDirectory, resourceRoot]) await mkdir(directory, { recursive: true });
    const managed = mode === 'ordinary' || mode === 'protected';
    const agent = new ProjectAgent({ projectId: randomUUID(), taskId: randomUUID(), projectDirectory, sessionDirectory, resourceRoot, codeRoot: process.cwd(), managementPorts: [],
      ...(!managed ? { workspace: { cwd: work, systemPrompt: ['Synthetic capability exclusion.'], defaultTools: [], ...(mode !== 'workspace' ? { capabilityPolicy: mode as 'fixed-draft' | 'text-only' | 'source-reader' } : {}) } } : {}),
      ...(managed ? { protectedExecution: { id: `modelpack-${mode}`, profile: mode as 'ordinary' | 'protected', cwd: work, writableRoot: work, readRoots: [] } } : {}),
      modelPackTools: { modelsRoot: path.join(root, 'models') },
      configuration: { id: randomUUID(), revision: 1, name: 'Synthetic exclusion', provider: 'openai-compatible', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic-key' } });
    t.after(() => agent.close());
    const snapshot = await agent.open();
    assert.deepEqual(snapshot.tools.filter(name => name.startsWith('modelpack_')), [], mode);
    await agent.close();
  }
});
