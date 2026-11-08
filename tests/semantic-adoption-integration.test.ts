import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigurationStore } from '../src/host/config-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { prepareSemanticAdoptionAssets } from '../src/host/semantic-adoption-assets.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { sessionEvents } from './fixtures/session-events.ts';

const execute = promisify(execFile), python = process.env.OPTRACALL_D17_PYTHON;
test('D17 fixed sources in nonempty Stores reach existing and feedback tasks through the real startup path, restart and graph-off', {
  skip: !python ? 'NOT_RUN: explicit pinned private Semantica interpreter required' : false, timeout: 120_000,
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-d17-integration-'));
  t.diagnostic(`D17 retained isolated root: ${root}`);
  const dataRoot = path.join(root, 'data'), projectsRoot = path.join(root, 'projects'), graphParent = path.join(root, 'semantic'), graphRoot = path.join(graphParent, 'release');
  for (const directory of ['evidence', 'inputs', 'snapshots']) await mkdir(path.join(graphRoot, directory), { recursive: true });
  const provider = await startToolProvider(); t.after(() => provider.close());
  const configuration = new ConfigurationStore({ dataRoot }); await configuration.init();
  const selected = await configuration.save({ name: 'D17 local synthetic only', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-d17', apiKey: 'synthetic-d17-only' });
  const store = new ProjectStore({ dataRoot, projectsRoot }); await store.init();
  const kept = await store.create({ name: 'D17 prior synthetic project', configuration: selected });
  await writeFile(path.join(kept.rootPath, '060_reports/kept.md'), 'D17_KEEP_PRIOR_REPORT');
  await store.close();
  const sourceManifest = JSON.parse(await readFile('openspec/changes/fourbase-l2-rollout/assets/adoption-sc01s-v0.2/sources.json', 'utf8'));
  const sources = Object.fromEntries(Object.entries(sourceManifest.sources).map(([key, value]: [string, any]) => [key, { path: path.resolve(value.path), sha256: value.sha256 }]));
  const assets = await prepareSemanticAdoptionAssets({ dataRoot, projectsRoot, projectName: 'D17 SC-01S synthetic adoption', publishedBy: 'Synthetic engineering preparation',
    sources: sources as Parameters<typeof prepareSemanticAdoptionAssets>[0]['sources'], configurationRef: { id: selected.id, revision: selected.revision },
    configurationSnapshot: ref => configuration.read(ref.id),
  });
  assert.equal(assets.refs.metrics.length, 3); assert.equal(assets.refs.metrics[0]!.version, '0.2.0');
  const priorStore = new ProjectStore({ dataRoot, projectsRoot }); await priorStore.init();
  const beforeStartup = await priorStore.createTask(assets.project.id, { name: 'Task created before this Host startup', configuration: selected });
  await priorStore.close();
  const buildInput = { run: graphRoot, permitted: graphParent, repo: process.cwd(), data: dataRoot, projects: projectsRoot, refs: assets.refs,
    excerpt: sources.metricExcerpt, analysis: { path: assets.analysisInput.path, sha256: assets.analysisInput.sha256 } };
  const buildCode = `import json,sys\nfrom pathlib import Path\nfrom fourbase_l2.build_sc01s import build_scene\nv=json.loads(sys.argv[1])\nr=build_scene(v['run'],v['repo'],approved_run_root=v['permitted'],source_root=v['repo'],data_root=v['data'],projects_root=v['projects'],refs=v['refs'],metric_excerpt_bytes=Path(v['excerpt']['path']).read_bytes(),metric_excerpt_sha256=v['excerpt']['sha256'],analysis_input_bytes=Path(v['analysis']['path']).read_bytes(),analysis_input_sha256=v['analysis']['sha256'],label='d17-adoption')\nprint(json.dumps({'snapshotId':r['snapshotId'],'keys':r['keys'],'counts':r['counts']}))`;
  const built = await execute(python!, ['-c', buildCode, JSON.stringify(buildInput)], { cwd: root, timeout: 60_000, maxBuffer: 1_000_000,
    env: { PATH: process.env.PATH ?? '/opt/homebrew/bin:/usr/bin:/bin', PYTHONPATH: path.join(process.cwd(), 'scripts'), PYTHONDONTWRITEBYTECODE: '1', HOME: root, TMPDIR: root } });
  const graph = JSON.parse(built.stdout.trim().split('\n').at(-1)!);
  const semanticConfig = path.join(dataRoot, 'semantic-graph.json');
  const configText = JSON.stringify({ schemaVersion: 1, enabled: true, python, projects: [{ projectId: assets.project.id, runRoot: graphRoot, snapshotId: graph.snapshotId }] });
  await writeFile(semanticConfig, configText);
  let host = await startTestHost({ dataRoot, projectsRoot, semanticConfig }); t.after(() => host.close());
  const health = await readJson(await host.request('/api/health'));
  assert.deepEqual(health.semanticGraph, { enabled: true, configurationSha256: createHash('sha256').update(configText).digest('hex'), assets: [{ projectId: assets.project.id, snapshotId: graph.snapshotId }] });
  assert.equal(provider.requests.length, 0, 'source publication, offline build and startup do not call the model');
  async function turn(taskId: string, extra = {}) {
    const events = await sessionEvents(host, assets.project.id, taskId);
    try {
      await readJson(await host.request(`/api/projects/${assets.project.id}/tasks/${taskId}/messages`, 'POST', { requestId: randomUUID(), text: 'Synthetic optional semantic lookup.', ...extra }), 202);
      const terminal = await events.terminal; assert.equal(terminal.type, 'run.settled'); if (terminal.type === 'run.settled') assert.equal(terminal.outcome, 'completed', JSON.stringify(terminal));
    } finally { await events.close(); }
    const state = await readJson(await host.request(`/api/projects/${assets.project.id}/tasks/${taskId}`));
    const bytes = await readFile(state.task.sessionFile);
    return { state, bytes, tools: bytes.toString().trim().split('\n').map(line => JSON.parse(line).message).filter(message => message?.role === 'toolResult') };
  }
  provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'Synthetic definition is a reference; business correctness remains unknown.' }
    : { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId: graph.keys.C04 } }] });
  const first = await turn(beforeStartup.id);
  assert.equal(first.tools.length, 1); assert.equal(first.tools[0].isError, false);
  assert.equal(first.tools[0].details.snapshot.id, graph.snapshotId); assert.equal(first.tools[0].details.nodes[0].id, graph.keys.C04);
  const { task: later } = await readJson(await host.request(`/api/projects/${assets.project.id}/tasks`, 'POST', { name: 'Later ordinary synthetic task' }), 201);
  const next = await turn(later.id); assert.equal(next.tools[0].isError, false); assert.equal(next.tools[0].details.snapshot.id, graph.snapshotId);
  const { item } = await readJson(await host.request('/api/decision-board/items', 'POST', { projectId: assets.project.id, title: 'Synthetic evidence action', rationale: 'No business effect claim' }), 201);
  await readJson(await host.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task: action } = await readJson(await host.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: 'Synthetic observation' }), 201);
  const { feedback } = await readJson(await host.request(`/api/decision-board/tasks/${action.id}/feedback`, 'POST', { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: 'D17_SYNTHETIC_FEEDBACK', metricDelta: '', review: 'Effect unknown', score: null, effect: 'unknown' }));
  const { preview } = await readJson(await host.request('/api/decision-feedback/preview', 'POST', { boardTaskId: action.id, feedbackRevisionId: feedback.revisionId, question: 'Synthetic review', taskName: 'Synthetic feedback task', materials: [{ id: 'feedback', kind: 'feedback', mode: 'full' }], sourceNature: 'synthetic', observationPeriod: 'Synthetic only', applicability: 'SC-01S', limitations: 'Effect unknown' }));
  const { handoff, task: review } = await readJson(await host.request('/api/decision-feedback/handoffs', 'POST', { operationId: randomUUID(), previewId: preview.previewId }), 201);
  const reviewed = await turn(review.id, { feedbackContext: { handoffId: handoff.handoffId, selectedMaterialIds: ['feedback'] } });
  assert.equal(reviewed.tools[0].isError, false); assert.equal(reviewed.tools[0].details.snapshot.id, graph.snapshotId);
  const requestCount = provider.requests.length;
  await host.close(); host = await startTestHost({ dataRoot, projectsRoot, semanticConfig });
  await readJson(await host.request(`/api/projects/${assets.project.id}/tasks/${beforeStartup.id}`));
  assert.deepEqual(await readFile(first.state.task.sessionFile), first.bytes); assert.equal(provider.requests.length, requestCount, 'restart and history read are passive');
  await host.close(); await writeFile(semanticConfig, JSON.stringify({ schemaVersion: 1, enabled: false }));
  host = await startTestHost({ dataRoot, projectsRoot, semanticConfig });
  assert.equal((await readJson(await host.request('/api/health'))).semanticGraph.enabled, false);
  provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'Original L1 lookup remains available; graph is off.' }
    : { calls: [{ name: 'read_semantic_context', arguments: { action: 'find', query: '零售额' } }] });
  const { task: l1 } = await readJson(await host.request(`/api/projects/${assets.project.id}/tasks`, 'POST', { name: 'Graph-off original ordinary path' }), 201);
  const fallback = await turn(l1.id); assert.equal(fallback.tools[0].isError, false); assert.equal(fallback.tools[0].details.type, 'optracall.semantic-context-result');
  assert.deepEqual(await readFile(first.state.task.sessionFile), first.bytes);
  assert.equal(await readFile(path.join(kept.rootPath, '060_reports/kept.md'), 'utf8'), 'D17_KEEP_PRIOR_REPORT');
  t.diagnostic(`D17 snapshot ${graph.snapshotId}, ${graph.counts.nodes} nodes, ${graph.counts.edges} edges; ${provider.requests.length} localhost synthetic continuations; no real model.`);
});
