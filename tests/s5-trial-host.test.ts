import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startSemanticTrialHost } from '../src/host/semantic-trial-host.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

const runtimeRoot = process.env.OPTRACALL_S5_TEST_ROOT;
const skip = !runtimeRoot ? 'NOT_RUN: explicit isolated S5 test root required' : false;
const codeRoot = process.cwd();
const uiPort = 4183;
async function json(response: Response, status = 200) {
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
}
async function roots() {
  assert.ok(runtimeRoot && path.isAbsolute(runtimeRoot));
  const root = await mkdtemp(path.join(runtimeRoot, 'host-chain-'));
  return { root, dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') };
}
function options(r: Awaited<ReturnType<typeof roots>>) {
  return { codeRoot, dataRoot: r.dataRoot, projectsRoot: r.projectsRoot, instanceId: randomUUID(), uiPort, transportVersion: '8.12.2' };
}
async function prepare(host: Awaited<ReturnType<typeof startSemanticTrialHost>>, baseUrl = 'http://127.0.0.1:9/v1') {
  const { configuration } = await json(await host.request('/api/configuration', 'PUT', { name: 'S5 synthetic only', provider: 'openai-compatible', baseUrl, model: 'synthetic-s5', apiKey: 'synthetic-s5-no-real-provider' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'S5 neutral engineering chain', configurationId: configuration.id }), 201);
  assert.deepEqual(project.tasks, []);
  return { configuration, project };
}
async function settled(host: Awaited<ReturnType<typeof startSemanticTrialHost>>, route: string, requestId: string) {
  const deadline = Date.now() + 45_000;
  for (;;) {
    const state = await json(await host.request(route));
    if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') return state;
    assert.ok(Date.now() < deadline, JSON.stringify(state.task.lastRun)); await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('S5A01 explicit independent roots are required before creating an original Host', { skip }, async () => {
  const r = await roots();
  await assert.rejects(startSemanticTrialHost({ ...options(r), dataRoot: '' }), /absolute/);
  await assert.rejects(startSemanticTrialHost({ ...options(r), projectsRoot: r.dataRoot }), /overlap/);
  await assert.rejects(startSemanticTrialHost({ ...options(r), projectsRoot: path.join(r.dataRoot, 'nested') }), /overlap/);
});

test('S5A03/05 taskless preparation closes before final Host; real POST fresh owner qualifies and restart does not restore it', { skip, timeout: 60_000 }, async t => {
  const r = await roots(); t.diagnostic(`retained S5 synthetic root: ${r.root}`);
  const prep = await startSemanticTrialHost(options(r)); t.after(() => prep.close());
  const { project, configuration } = await prepare(prep);
  const close = prep.close(); assert.equal(prep.close(), close, 'all callers await the same actual original Host close promise'); await close;
  const final = await startSemanticTrialHost(options(r)); t.after(() => final.close());
  const task = await final.createTask(project.id, { name: 'first task after final Host startup', configurationId: configuration.id });
  assert.match(task.id, /^[a-f0-9-]{36}$/); assert.equal(task.sessionFile, undefined); assert.equal(task.lastRun, undefined);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const fresh = await json(await final.request(route + '/automatic-verification/capabilities'));
  if (process.platform === 'darwin') assert.equal(fresh.supported, true, JSON.stringify(fresh));
  else assert.equal(fresh.supported, false, 'unsupported OS stays unsupported');
  await assert.rejects(final.createTask(project.id, { name: 'must not create a sibling evaluation owner' }), /first task/);
  assert.equal((await json(await final.request(`/api/projects/${project.id}`))).project.tasks.length, 1);
  await final.close();
  const reopened = await startSemanticTrialHost(options(r)); t.after(() => reopened.close());
  const old = await json(await reopened.request(route + '/automatic-verification/capabilities'));
  assert.equal(old.supported, false, 'restart never upgrades a historical owner to a fresh managed owner');
  assert.equal((await json(await reopened.request(route))).task.id, task.id);
});

test('S5A01/05 L2 binds the real 201 owner before first open/messages; unknown task/project and L1 retain original graph rejection', { skip, timeout: 120_000 }, async t => {
  const r = await roots(), provider = await startToolProvider(); t.after(() => provider.close());
  t.diagnostic(`retained S5 synthetic root: ${r.root}`);
  const prep = await startSemanticTrialHost(options(r)); t.after(() => prep.close());
  const { project, configuration } = await prepare(prep, provider.baseUrl); await prep.close();
  // Deliberately unavailable executable proves dispatch reached the trusted
  // graph seam without importing old S2/S3 Python, snapshots, or business roots.
  const graphBinding = { runRoot: path.join(r.root, 'derived'), snapshotId: randomUUID(), python: path.join(r.root, 'no-python'), codeRoot };
  const final = await startSemanticTrialHost({ ...options(r), graphBinding }); t.after(() => final.close());
  graphBinding.python = '/usr/bin/false'; // Caller mutation cannot replace the startup pin.
  const task = await final.createTask(project.id, { name: 'bound real owner', configurationId: configuration.id });
  const { task: sibling } = await json(await final.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'unlisted sibling' }), 201);
  const { project: otherProject } = await json(await final.request('/api/projects', 'POST', { name: 'unlisted project', configurationId: configuration.id }), 201);
  const { task: otherTask } = await json(await final.request(`/api/projects/${otherProject.id}/tasks`, 'POST', { name: 'unlisted project task' }), 201);
  const graphResults: string[] = [];
  provider.setResponder(({ recentToolResults }) => {
    if (!recentToolResults.length) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'find', query: 'synthetic' } }] };
    graphResults.push(providerMessageText(recentToolResults.at(-1)?.content)); return { text: 'Synthetic graph outcome retained.' };
  });
  const routes = [task, sibling].map(value => `/api/projects/${project.id}/tasks/${value.id}`);
  routes.push(`/api/projects/${otherProject.id}/tasks/${otherTask.id}`);
  for (const route of routes) {
    await json(await final.request(route + '/open', 'POST', {}));
    const requestId = randomUUID(); await json(await final.request(route + '/messages', 'POST', { requestId, text: 'Synthetic graph permission probe; no business calculation.' }), 202);
    assert.equal((await settled(final, route, requestId)).task.lastRun.status, 'completed');
  }
  assert.match(graphResults[0]!, /optracall.semantic-graph-result/, 'the exact bound owner must receive graph JSON through the real SDK');
  assert.equal(JSON.parse(graphResults[0]!).type, 'optracall.semantic-graph-result');
  assert.equal(JSON.parse(graphResults[0]!).code, 'semantic_graph_process_unavailable');
  for (const result of graphResults.slice(1)) { assert.match(result, /validation|Invalid|unexpected|additional|match|schema/i); assert.doesNotMatch(result, /optracall.semantic-graph-result/); }
  const saved = await json(await final.request(routes[0]!));
  assert.match(await readFile(saved.task.sessionFile, 'utf8'), /semantic_graph_process_unavailable/);
  assert.equal(provider.requests.length, 6, 'each original SDK task receives one tool attempt and one final continuation');
  assert.deepEqual(provider.errors, []);
  await final.close();
  const l1Roots = await roots(), l1 = await startSemanticTrialHost(options(l1Roots)); t.after(() => l1.close());
  const l1Prepared = await prepare(l1, provider.baseUrl), l1Task = await l1.createTask(l1Prepared.project.id, { name: 'L1 original tools' });
  const l1Route = `/api/projects/${l1Prepared.project.id}/tasks/${l1Task.id}`, requestId = randomUUID();
  await json(await l1.request(l1Route + '/messages', 'POST', { requestId, text: 'Synthetic L1 graph rejection probe.' }), 202); await settled(l1, l1Route, requestId);
  assert.match(graphResults.at(-1)!, /validation|Invalid|unexpected|additional|match|schema/i);
  assert.doesNotMatch(graphResults.at(-1)!, /optracall.semantic-graph-result/);
});

test('S5A05 sequential chain roots do not expose the prior project, report, enterprise material, or saved configuration', { skip, timeout: 60_000 }, async t => {
  const a = await roots(), first = await startSemanticTrialHost(options(a)); t.after(() => first.close());
  const { project } = await prepare(first);
  await json(await first.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'only-chain-a.md', text: 'S5_SYNTHETIC_PRIOR_CHAIN_REPORT' }), 201);
  const { material } = await json(await first.request('/api/enterprise-materials', 'POST', { title: 'S5 chain A only', body: 'S5_SYNTHETIC_PRIOR_CHAIN_MATERIAL' }), 201);
  await first.close();
  const b = await roots(), second = await startSemanticTrialHost(options(b)); t.after(() => second.close());
  assert.notEqual(a.dataRoot, b.dataRoot); assert.notEqual(a.projectsRoot, b.projectsRoot);
  assert.deepEqual((await json(await second.request('/api/projects'))).projects, []);
  for (const route of [`/api/projects/${project.id}`, `/api/projects/${project.id}/files/content?path=060_reports/only-chain-a.md`, `/api/enterprise-materials/${material.id}`]) {
    const response = await second.request(route), value = await response.json();
    assert.ok(response.status >= 400, 'the original Host must refuse a prior-chain identity');
    assert.doesNotMatch(JSON.stringify(value), /S5_SYNTHETIC_PRIOR_CHAIN_REPORT|S5_SYNTHETIC_PRIOR_CHAIN_MATERIAL/);
  }
  const materials = await json(await second.request('/api/enterprise-materials'));
  assert.doesNotMatch(JSON.stringify(materials), /S5_SYNTHETIC_PRIOR_CHAIN_MATERIAL|S5 chain A only/);
  const configuration = await json(await second.request('/api/configuration'));
  assert.doesNotMatch(JSON.stringify(configuration), /synthetic-s5|S5 synthetic only/);
});
