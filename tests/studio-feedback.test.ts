import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import type { ProjectSnapshot } from '../src/agent/project-runtime.ts';
import type { SemanticGraphResult, SemanticGraphSourceRef } from '../extensions/business-plugins/semantic-context/graph.ts';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const configuration = { id: 'synthetic-model', revision: 1, name: '合成配置', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
const graph = (id: string): SemanticGraphResult => ({ schemaVersion: 1, type: 'optracall.semantic-graph-result', action: 'graph', operation: 'find', state: 'available', snapshot: { id, graphSha256: 'a'.repeat(64), ontologySha256: 'b'.repeat(64), componentVersion: '0.7.0' }, nodes: [], edges: [], paths: [], sources: [], coverage: { complete: true, continuation: null, gaps: [], exhausted: true } });
const metadata = (refs: SemanticGraphSourceRef[]) => ({ sourceRefs: refs, buildSources: [], claimKind: 'source-projection' as const, conditions: [], limitations: [], businessTime: [] });
async function fixture(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-feedback-')), dataRoot = path.join(root, 'private');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot), store = new StudioStore(dataRoot);
  const construction = await projects.create({ name: '建设项目', configuration }), task = await projects.createTask(construction.id, { name: '建设任务' });
  const usingProject = await projects.create({ name: '使用项目', configuration }), usingTask = await projects.createTask(usingProject.id, { name: '使用任务' });
  const system = store.create({ name: '旧出处保留体系', projectId: construction.id, taskId: task.id, topicTitle: '退款', goal: '旧回复准确出处' }); store.linkUsageProject(system.id, usingProject.id, usingTask.id);
  const source = { authority: 'enterprise' as const, id: 'synthetic-policy', version: 'old-1' }, input = { kind: 'rule' as const, title: '准确规则', body: 'OLD-FORMAL-ONE', scope: '合成企业', sources: [source], readyForPublication: true };
  const asset = store.saveAsset(system.id, input), unobserved = store.saveAsset(system.id, { ...input, title: 'NOT-READ-IN-OLD-TURN' });
  let preview = store.preparePublication(system.id, { assetIds: [asset.id, unobserved.id], summary: '旧准确版', scope: '合成企业' }); store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const oldRef: SemanticGraphSourceRef = { kind: 'studio-source', systemId: system.id, assetId: asset.id, version: '1', publishedHash: asset.revisions[0].sha256, projectId: construction.id };
  const revised = store.saveAsset(system.id, { ...input, assetId: asset.id, expectedRevision: 1, body: 'CURRENT-FORMAL-TWO' }); preview = store.preparePublication(system.id, { assetIds: [asset.id], summary: '新准确版', scope: '合成企业' }); store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const newRef = { ...oldRef, version: '2', publishedHash: revised.revisions[1].sha256 }, oldSnapshot = randomUUID(), newSnapshot = randomUUID(), sessionId = randomUUID(), messageId = 'old-reply';
  const oldGraph = graph(oldSnapshot), newGraph = graph(newSnapshot); newGraph.nodes.push({ id: 'new', type: 'Statement', content: '当前规则', metadata: metadata([newRef]) });
  const reply = '旧任务当时按准确旧图资料作答，不代表实际使用已验证。';
  const snapshot: ProjectSnapshot = { sessionId, tools: ['read_semantic_context'], status: 'idle', sdkVersion: 'synthetic-snapshot-fixture', capabilities: {}, messages: [] };
  const oldTool: Record<string, any> = { role: 'toolResult', toolName: 'read_semantic_context', toolCallId: 'old-tool', content: [{ type: 'text', text: JSON.stringify(oldGraph) }], details: oldGraph, isError: false };
  const setTurn = () => { oldTool.content = [{ type: 'text', text: JSON.stringify(oldTool.details.type === 'optracall.studio' ? oldTool.details.result : oldTool.details) }]; snapshot.messages = [{ role: 'user', content: '旧轮问题' }, oldTool, { role: 'assistant', nativeSessionId: sessionId, nativeEntryId: messageId, content: [{ type: 'text', text: reply }] }, { role: 'user', content: '新轮问题' }, { role: 'toolResult', toolName: 'read_semantic_context', toolCallId: 'new-tool', details: newGraph, isError: false }, { role: 'assistant', nativeSessionId: sessionId, nativeEntryId: 'new-reply', content: [{ type: 'text', text: '当前新版答复' }] }]; };
  const feature = createStudioFeature({ dataRoot, projects, enterpriseMaterials, mutate: async operation => operation(), running: () => false, closing: () => false,
    readBody: async request => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString('utf8')); },
    taskSnapshot: async (projectId, taskId) => { if (projectId === usingProject.id) { assert.equal(taskId, usingTask.id); return snapshot; } return { ...snapshot, messages: [] }; },
    readTaskReply: async (projectId, taskId, selection) => { assert.equal(projectId, usingProject.id); assert.equal(taskId, usingTask.id); assert.deepEqual(selection, { sessionId, messageId }); return { text: reply }; },
  });
  const server = createServer((request, response) => { void feature.handle(request, response, new URL(request.url!, 'http://localhost')).catch(error => { response.writeHead(500); response.end(String(error)); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); const port = address.port;
  t.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  async function send(problem: string) { setTurn(); const response = await fetch(`http://127.0.0.1:${port}/api/studio/systems/${system.id}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, body: JSON.stringify({ requestId: randomUUID(), title: '旧回复反馈', problem, sources: [], origin: { projectId: usingProject.id, taskId: usingTask.id, sessionId, messageId, useId: 'FORGED-UNTRUSTED', graphSnapshotId: newSnapshot } }) }); assert.equal(response.status, 200, await response.clone().text()); return (await response.json() as any).system.feedback.at(-1); }
  return { store, system, asset, unobserved, oldRef, oldGraph, oldTool, oldSnapshot, construction, usingProject, usingTask, sessionId, messageId, reply, send };
}

for (const placement of ['nodes', 'edges', 'sources'] as const) test(`HTTP feedback captures the old graph ${placement} exact source and snapshot without declare-use or current-store substitution`, async t => {
  const f = await fixture(t);
  if (placement === 'nodes') f.oldGraph.nodes.push({ id: 'old-rule', type: 'Statement', content: '旧规则', metadata: metadata([f.oldRef]) });
  if (placement === 'edges') f.oldGraph.edges.push({ id: 'old-edge', source: 'refund', target: 'store', type: 'asserted_relation', metadata: metadata([f.oldRef]) });
  if (placement === 'sources') f.oldGraph.sources.push({ sourceHandle: 'old-handle', ref: f.oldRef, body: '旧准确源', range: null, nature: 'asset-publication', gaps: [] });
  const feedback = await f.send(`旧${placement}出处问题`), captured = feedback.sources.filter((ref: any) => ref.authority === 'studio-source');
  assert.equal(captured.length, 1, JSON.stringify(feedback)); assert.equal(captured[0].id, f.asset.id); assert.equal(captured[0].version, '1'); assert.equal(captured[0].sha256, f.oldRef.publishedHash);
  assert.equal(captured.some((ref: any) => ref.id === f.unobserved.id), false); assert.equal(feedback.origin.graphSnapshotId, f.oldSnapshot); assert.equal(feedback.origin.useId, undefined);
  assert.equal(feedback.sources.find((ref: any) => ref.authority === 'task').sha256, sha(f.reply)); assert.equal(feedback.status, 'recorded'); assert.equal(f.store.get(f.system.id).uses.length, 0); assert.equal(f.store.get(f.system.id).assets.find(asset => asset.id === f.asset.id)!.formalRevision, 2);
});

test('HTTP feedback retains actually read original SAP/method hashes and exact enterprise revision even when the original graph schema has no enterprise hash', async t => {
  const f = await fixture(t), methodId = randomUUID();
  const metric: SemanticGraphSourceRef = { kind: 'sap', packageId: 'old-refund-package', version: '1.0.0', metricName: 'refund_amount', publishedHash: 'c'.repeat(64) };
  const method: SemanticGraphSourceRef = { kind: 'sap-method', methodId, version: 1, publishedHash: 'd'.repeat(64) };
  const enterprise: SemanticGraphSourceRef = { kind: 'enterprise', storeId: 'exact-old-store', materialId: 'exact-old-material', revisionId: 'exact-old-revision' };
  f.oldGraph.nodes.push({ id: 'old-metric', type: 'MetricVersion', content: '原准确指标', metadata: metadata([metric]) });
  f.oldGraph.edges.push({ id: 'old-method-edge', source: 'metric', target: 'method', type: 'has_source', metadata: metadata([method]) });
  f.oldGraph.sources.push({ sourceHandle: 'old-enterprise-handle', ref: enterprise, body: '旧制度准确正文', range: { start: 0, end: 7, total: 7 }, nature: 'deidentified-source', gaps: [] });
  const feedback = await f.send('旧SAP方法及制度出处'), captured = feedback.sources.filter((ref: any) => ref.authority !== 'task');
  assert.equal(captured.length, 3, JSON.stringify(feedback));
  const sap = captured.find((ref: any) => ref.authority === 'sap-metric'), sapMethod = captured.find((ref: any) => ref.authority === 'sap-method'), source = captured.find((ref: any) => ref.authority === 'enterprise');
  assert.equal(sap.id, metric.packageId); assert.equal(sap.version, '1.0.0'); assert.equal(sap.sha256, metric.publishedHash); assert.deepEqual(JSON.parse(sap.locator), { metricName: 'refund_amount' });
  assert.equal(sapMethod.id, methodId); assert.equal(sapMethod.version, '1'); assert.equal(sapMethod.sha256, method.publishedHash);
  assert.equal(source.id, enterprise.materialId); assert.equal(source.version, enterprise.revisionId); assert.equal(source.locator, enterprise.storeId); assert.equal(feedback.origin.graphSnapshotId, f.oldSnapshot);
});

test('HTTP feedback captures stable M2 graph revisions without inventing absent hashes or serializing graph-only source handles into the original target', async t => {
  const f = await fixture(t);
  const input: SemanticGraphSourceRef = { kind: 'data-input', projectId: f.usingProject.id, datasetId: 'old-dataset', inputVersionId: 'old-input-version', sourceHandle: 'graph-only-input-handle' };
  const description: SemanticGraphSourceRef = { kind: 'data-description', projectId: f.usingProject.id, datasetId: 'old-dataset', inputVersionId: 'old-input-version', descriptionRevisionId: 'old-description-version', sourceHandle: 'graph-only-description-handle' };
  f.oldGraph.nodes.push({ id: 'old-input', type: 'InputVersion', content: '原数据准确版本', metadata: metadata([input]) });
  f.oldGraph.edges.push({ id: 'old-description-edge', source: 'input', target: 'description', type: 'describes_input', metadata: metadata([description]) });
  const feedback = await f.send('旧数据及描述出处'), refs = feedback.sources.filter((ref: any) => ref.authority === 'data');
  assert.equal(refs.length, 2, JSON.stringify(feedback));
  const actualInput = refs.find((ref: any) => ref.version === 'old-input-version'), actualDescription = refs.find((ref: any) => ref.version === 'old-description-version');
  for (const ref of [actualInput, actualDescription]) { assert.ok(ref); assert.equal(ref.id, 'old-dataset'); assert.equal(ref.projectId, f.usingProject.id); assert.equal(ref.taskId, f.usingTask.id); assert.equal(ref.sha256, undefined); assert.equal(JSON.parse(ref.locator).sourceHandle, undefined); }
  assert.deepEqual(JSON.parse(actualInput.locator), { kind: 'data-input', projectId: f.usingProject.id, datasetId: 'old-dataset', inputVersionId: 'old-input-version' });
  assert.deepEqual(JSON.parse(actualDescription.locator), { kind: 'data-description', projectId: f.usingProject.id, datasetId: 'old-dataset', inputVersionId: 'old-input-version', descriptionRevisionId: 'old-description-version' });
  assert.equal(feedback.origin.graphSnapshotId, f.oldSnapshot); assert.equal(feedback.origin.useId, undefined);
});

for (const action of ['read', 'read-source'] as const) test(`HTTP feedback preserves an old actual Studio ${action} exact ref without substituting the current formal revision`, async t => {
  const f = await fixture(t), ref = { authority: 'studio-source' as const, id: f.asset.id, version: '1', sha256: f.oldRef.publishedHash, projectId: f.construction.id, locator: f.system.id };
  f.oldTool.toolName = 'studio_assets'; f.oldTool.details = { type: 'optracall.studio', action, result: action === 'read' ? { ...f.asset.revisions[0], ref } : { text: f.asset.revisions[0].body, complete: true, ref } };
  f.oldTool.content = [{ type: 'text', text: JSON.stringify(f.oldTool.details.result) }];
  const feedback = await f.send(`旧Studio ${action}出处`), sources = feedback.sources.filter((source: any) => source.authority === 'studio-source');
  assert.deepEqual(sources, [ref]); assert.equal(feedback.origin.graphSnapshotId, undefined); assert.equal(feedback.origin.useId, undefined); assert.equal(f.store.get(f.system.id).uses.length, 0);
});
