import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSemanticGraphAuthority } from '../src/host/semantic-graph-authority.ts';
import type { StudioSemanticGraphSourceRef } from '../extensions/business-plugins/semantic-context/graph.ts';
import type { ProjectStore } from '../src/host/project-store.ts';
import type { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import type { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import type { SemanticContextService } from '../src/host/semantic-context-service.ts';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ref: StudioSemanticGraphSourceRef = { kind: 'studio-source', systemId: 'retail', assetId: 'refund-rule', version: '1', publishedHash: 'a'.repeat(64), projectId: 'construction-project' };
const ctx = () => ({ signal: new AbortController().signal, assertCurrent() {} });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-authority-'))), snapshotId = randomUUID();
  const folder = join(root, 'snapshots', snapshotId); await mkdir(folder, { recursive: true });
  const graph = JSON.stringify({ graph_id: snapshotId, nodes: [{ properties: { sourceRefs: [ref], buildSources: [] } }], edges: [] });
  await writeFile(join(folder, 'graph.json'), graph);
  await writeFile(join(folder, 'receipt.json'), JSON.stringify({ formatVersion: 2, snapshotId, files: { graph: { name: 'graph.json', bytes: Buffer.byteLength(graph), sha256: sha(graph) } }, inputs: [] }));
  const projects = { getTask: async () => ({}), get: async () => ({ archivedAt: null }) } as unknown as ProjectStore;
  return { root, snapshotId, options: { projectId: 'analysis-project', taskId: 'analysis-task', projects,
    data: {} as ProjectDataContextStore, enterprise: {} as EnterpriseMaterialsStore,
    reader: {} as SemanticContextService, dataRoot: root, binding: { runRoot: root, snapshotId, python: 'unused', codeRoot: process.cwd() } } };
}

test('v2 graph delegates only declared formal source identities to an injected Studio authority and preserves the real analysis owner', async () => {
  const f = await fixture(), seen: string[] = [];
  const authority = createSemanticGraphAuthority({ ...f.options, studioSources: {
    async check(actual, context) { seen.push(context.projectId); assert.deepEqual(actual, ref); return { state: 'available', gaps: [], observedHash: ref.publishedHash, revision: 'exact-governance-1' }; },
    async read() { return { state: 'available', body: '成功退款归原销售门店', gaps: [] }; },
  } });
  assert.equal((await authority.checkMany([ref], ctx()))[0]?.state, 'available');
  assert.ok(seen.every(owner => owner === 'analysis-project'));
  assert.equal((await authority.readSource({ kind: 'ref', ref }, ctx())).body, '成功退款归原销售门店');
  const previous = seen.length;
  assert.equal((await authority.checkMany([{ ...ref, version: '2' }], ctx()))[0]?.state, 'forbidden');
  assert.equal(seen.length, previous, 'snapshot declaration cannot grant arbitrary newer source reads');
});

import { createSemanticGraphService, type SemanticGraphWorkerResult } from '../src/host/semantic-graph-service.ts';
test('the existing graph service accepts variable-sized v2 source manifests without imposing the old nine-input fixture', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-service-'))), snapshotId = randomUUID();
  const directory = join(root, 'snapshots', snapshotId); await mkdir(directory, { recursive: true }); await mkdir(join(root, 'inputs'));
  const bytes = JSON.stringify({ body: '成功退款归原销售门店' }); await writeFile(join(root, 'inputs', 'source.json'), bytes);
  const inputs = [{ inputKey: 'source', relativePath: 'inputs/source.json', sha256: sha(bytes), bytes: Buffer.byteLength(bytes), nature: 'asset-publication' }];
  const graph = '{}', ontology = '{}'; await writeFile(join(directory, 'graph.json'), graph); await writeFile(join(directory, 'ontology.json'), ontology);
  const receipt = JSON.stringify({ formatVersion: 2, snapshotId, inputs, files: { graph: { name: 'graph.json', sha256: sha(graph), bytes: Buffer.byteLength(graph) }, ontology: { name: 'ontology.json', sha256: sha(ontology), bytes: Buffer.byteLength(ontology) } } });
  await writeFile(join(directory, 'receipt.json'), receipt);
  const canonical = (value: unknown): string => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}' : JSON.stringify(value);
  const worker: SemanticGraphWorkerResult = { snapshot: { id: snapshotId, graphSha256: sha(graph), ontologySha256: sha(ontology), componentVersion: '0.7.0' },
    state: 'available', nodes: [{ id: 'refund', type: 'Statement', content: '成功退款', metadata: { sourceRefs: [ref], buildSources: [], claimKind: 'source-projection', conditions: [], limitations: [], businessTime: [] } }], edges: [], paths: [], gaps: [], exhausted: true, currentRefs: [ref], inputFingerprint: sha(canonical(inputs)), receiptSha256: sha(receipt) };
  const service = createSemanticGraphService({ bindingFor: () => ({ runRoot: root, snapshotId, python: 'unused', codeRoot: process.cwd() }),
    authorityFor: () => ({ checkMany: async refs => refs.map(value => ({ ref: value, state: 'available', gaps: [], observedHash: ref.publishedHash, revision: 'formal-1' })), readSource: async () => ({ state: 'available', body: '成功退款归原销售门店', gaps: [] }) }), runProcess: async options => { await options.checkMany([ref]); return worker; } });
  const result = await service.query('analysis', 'task', { action: 'graph', operation: 'definition', nodeId: 'refund' }, { ...ctx(), requestId: 'request', sessionId: 'session', toolCallId: 'tool', runToken: {} });
  assert.equal(result.nodes[0]?.content, '成功退款');
  assert.equal(result.snapshot?.id, snapshotId);
});

test('unconfigured Studio source authority and mismatched published hashes stay unavailable', async () => {
  const f = await fixture();
  const unconfigured = createSemanticGraphAuthority(f.options);
  assert.equal((await unconfigured.checkMany([ref], ctx()))[0]?.state, 'forbidden');
  let read = false;
  const changed = createSemanticGraphAuthority({ ...f.options, studioSources: {
    async check() { return { state: 'available', gaps: [], observedHash: 'b'.repeat(64) }; },
    async read() { read = true; return { state: 'available', body: 'not returned', gaps: [] }; },
  } });
  assert.equal((await changed.readSource({ kind: 'ref', ref }, ctx())).state, 'hash-conflict');
  assert.equal(read, false);
});
