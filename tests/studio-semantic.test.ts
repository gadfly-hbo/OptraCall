import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runStudioSemanticExtraction, type StudioSemanticOptions } from '../src/host/studio-semantic.ts';

const text = '成功退款归原销售门店。一个订单可以有多次成功退款。';
const options = (overrides: Partial<StudioSemanticOptions> = {}): StudioSemanticOptions => ({
  python: '/not-used', codeRoot: process.cwd(),
  source: { id: 'refund-policy', revision: '2', sha256: createHash('sha256').update(text).digest('hex'), text, locator: '§3' },
  signal: new AbortController().signal, assertCurrent() {}, complete: async () => ({}), ...overrides,
});

test('official extraction refuses text whose exact-source identity no longer matches', async () => {
  let called = false;
  await assert.rejects(runStudioSemanticExtraction(options({ source: { ...options().source, text: text + '未获准内容' }, complete: async () => { called = true; return {}; } })), /studio_semantic_source_integrity_mismatch/);
  assert.equal(called, false);
});

const python = process.env.OPTRACALL_STUDIO_TEST_PYTHON;
test('official Semantica extraction calls only the injected Pi completion and returns source-bound candidates', { skip: !python }, async () => {
  const calls: string[] = [];
  const result = await runStudioSemanticExtraction(options({ python: python!, complete: async request => {
    calls.push(`${request.kind}:${request.format}`);
    return request.kind === 'entities'
      ? { entities: [{ text: '退款', label: 'EVENT', confidence: 0.9 }, { text: '门店', label: 'ORG', confidence: 0.9 }] }
      : { relations: [{ subject: '退款', object: '门店', predicate: '归属', confidence: 0.9 }] };
  } }));
  assert.deepEqual(calls, ['entities:typed', 'relations:typed']);
  assert.equal(result.component.version, '0.7.0');
  assert.equal(result.source.sha256, options().source.sha256);
  assert.deepEqual(result.entities.map(entity => entity.text), ['退款', '门店']);
  assert.equal(result.relations[0]?.predicate, '归属');
  assert.equal(result.relations[0]?.provenance.revision, '2');
  assert.equal(result.candidateNeedsReview, true);
  assert.deepEqual(result.failures, []);
});

import { mkdtemp, mkdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStudioSemanticSnapshot } from '../src/host/studio-semantic.ts';
import { runSemanticGraphProcess } from '../src/host/semantic-graph-process.ts';
import { createSemanticGraphService } from '../src/host/semantic-graph-service.ts';
import { createSemanticGraphAuthority } from '../src/host/semantic-graph-authority.ts';
import type { ProjectStore } from '../src/host/project-store.ts';
import type { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import type { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import type { SemanticContextService } from '../src/host/semantic-context-service.ts';

test('official structured graph build creates a new immutable v2 snapshot readable by the model-free graph worker', { skip: !python }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-semantic-')));
  await mkdir(join(root, 'inputs'));
  const ref = { kind: 'studio-source' as const, systemId: 'retail', assetId: 'ontology', version: '1', publishedHash: 'a'.repeat(64), projectId: 'construction' };
  const qualify = async (refs: unknown[]) => refs.map(() => ({ state: 'available', gaps: [] }));
  const result = await buildStudioSemanticSnapshot({ python: python!, codeRoot: process.cwd(), runRoot: root,
    sources: [{ ref, title: '退款归属', kind: 'ontology', body: JSON.stringify({ entities: [{ key: 'refund', text: '退款', label: 'EVENT' }, { key: 'store', text: '门店', label: 'ORG' }], relationships: [{ source: 'refund', target: 'store', predicate: '归属' }] }) }],
    signal: new AbortController().signal, assertCurrent() {}, checkMany: qualify,
  });
  assert.equal(result.formatVersion, 2);
  const receipt = JSON.parse(await readFile(join(root, 'snapshots', result.snapshotId, 'receipt.json'), 'utf8'));
  assert.equal(receipt.formatVersion, 2);
  assert.equal(receipt.component.version, '0.7.0');
  const graph = await runSemanticGraphProcess<{ nodes: Array<{ content: string }>; edges: Array<{ type: string; metadata: { predicate?: string } }> }>({ binding: { runRoot: root, snapshotId: result.snapshotId, python: python!, codeRoot: process.cwd() }, query: { action: 'graph', operation: 'find', query: '退款' }, signal: new AbortController().signal, assertCurrent() {}, checkMany: qualify });
  assert.ok(graph.nodes.some(node => node.content === '退款'));
  // The same actual v2 files also pass the existing final-read Host service,
  // including current-source qualification and its authenticated source handle.
  let state: 'available' | 'disabled' = 'available';
  const body = JSON.stringify({ entities: [{ key: 'refund', text: '退款', label: 'EVENT' }, { key: 'store', text: '门店', label: 'ORG' }], relationships: [{ source: 'refund', target: 'store', predicate: '归属' }] });
  const binding = { runRoot: root, snapshotId: result.snapshotId, python: python!, codeRoot: process.cwd() };
  const authority = createSemanticGraphAuthority({ projectId: 'analysis', taskId: 'task', binding, dataRoot: root,
    projects: { getTask: async () => ({}), get: async () => ({ archivedAt: null }) } as unknown as ProjectStore,
    data: {} as ProjectDataContextStore, enterprise: {} as EnterpriseMaterialsStore, reader: {} as SemanticContextService,
    studioSources: { check: async () => ({ state, gaps: [], observedHash: ref.publishedHash, revision: state }), read: async () => ({ state, body, gaps: [] }) },
  });
  const service = createSemanticGraphService({ bindingFor: () => binding, authorityFor: () => authority });
  const context = { signal: new AbortController().signal, assertCurrent() {}, requestId: 'request', sessionId: 'session', toolCallId: 'tool', runToken: {} };
  const page = await service.query('analysis', 'task', { action: 'graph', operation: 'find', query: '退款' }, context);
  assert.ok(page.nodes.some(node => node.content === '退款'));
  const handle = page.nodes.find(node => node.content === '退款')!.metadata.sourceRefs[0]!.sourceHandle!;
  const source = await service.query('analysis', 'task', { action: 'graph', operation: 'source', sourceHandle: handle }, context);
  assert.equal(source.sources[0]?.body, body);
  state = 'disabled';
  const unavailable = await service.query('analysis', 'task', { action: 'graph', operation: 'find', query: '退款' }, context);
  assert.deepEqual(unavailable.nodes, []);

  const original = await readFile(join(root, 'snapshots', result.snapshotId, 'graph.json'));
  const again = await buildStudioSemanticSnapshot({ python: python!, codeRoot: process.cwd(), runRoot: root,
    sources: [{ ref, title: '退款规则', kind: 'rule', body: '退款归原销售门店' }], signal: new AbortController().signal, assertCurrent() {}, checkMany: qualify });
  assert.notEqual(again.snapshotId, result.snapshotId);
  assert.deepEqual(await readFile(join(root, 'snapshots', result.snapshotId, 'graph.json')), original);
});

test('official empty typed relations use its structured fallback and weak returned relationships remain clues', { skip: !python }, async () => {
  const result = await runStudioSemanticExtraction(options({ python: python!, complete: async request => request.kind === 'entities'
    ? { entities: [{ text: '退款', label: 'EVENT' }, { text: '门店', label: 'ORG' }] }
    : request.format === 'typed' ? { relations: [] } : { relations: [{ subject: '退款', object: '门店', predicate: 'related_to' }] } }));
  assert.deepEqual(result.calls.map(call => `${call.kind}:${call.format}`), ['entities:typed', 'relations:typed', 'relations:structured']);
  assert.ok(result.limitations.includes('official-structured-fallback-attempted'));
  assert.equal(result.relations[0]?.weak, true);
  assert.ok(result.limitations.includes('weak-relations-are-clues-only'));
  assert.equal(result.candidateNeedsReview, true);
});

test('Pi completion failure is recorded without silently choosing a different provider or leaking its error body', { skip: !python }, async () => {
  let calls = 0;
  const result = await runStudioSemanticExtraction(options({ python: python!, complete: async () => { calls++; throw new Error('private-response-body-must-not-leak'); } }));
  assert.equal(calls, 1);
  assert.deepEqual(result.failures, ['entities_failed']);
  assert.equal(result.calls[0]?.state, 'failed');
  assert.deepEqual(result.entities, []);
  assert.equal(JSON.stringify(result).includes('private-response-body'), false);
});

test('cancellation closes the owned worker and waits for an already dispatched Pi callback without accepting its late answer', { skip: !python, timeout: 10000 }, async () => {
  const controller = new AbortController();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const request = runStudioSemanticExtraction(options({ python: python!, signal: controller.signal,
    complete: async () => { entered(); await blocked; return { entities: [{ text: '退款', label: 'EVENT' }] }; },
  }));
  const outcome = request.then(() => { settled = true; throw new Error('cancelled extraction resolved'); }, error => { settled = true; return error as Error; });
  await started; controller.abort(new Error('cancelled-by-user'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false);
  release(); assert.match((await outcome).message, /cancelled-by-user/);
});

test('a source withdrawn since publication cannot build a new formal-source graph', { skip: !python }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-semantic-')));
  await assert.rejects(buildStudioSemanticSnapshot({ python: python!, codeRoot: process.cwd(), runRoot: root,
    sources: [{ ref: { kind: 'studio-source', systemId: 's', assetId: 'a', version: '1', publishedHash: 'b'.repeat(64), projectId: 'p' }, title: '旧规则', kind: 'rule', body: '此源已撤回' }],
    signal: new AbortController().signal, assertCurrent() {}, checkMany: async refs => refs.map(() => ({ state: 'forbidden', gaps: [] })),
  }), /studio_semantic_worker_failed/);
});

import { parseSemanticGraphQuery } from '../extensions/business-plugins/semantic-context/graph.ts';
test('Studio asserted relations are explicit graph edges rather than invented dependency semantics', () => {
  assert.deepEqual(parseSemanticGraphQuery({ action: 'graph', operation: 'neighbors', nodeId: 'refund', relationTypes: ['asserted_relation'] }).operation, 'neighbors');
});

test('known SAP exact definitions build through the structured path without any LLM or SC-01 metric quota', { skip: !python }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-sap-')));
  const ref = { kind: 'sap' as const, packageId: 'synthetic-new-retail', version: '2.0.0', metricName: 'settled_refund_amount', publishedHash: 'c'.repeat(64) };
  const qualify = async (refs: unknown[]) => refs.map(() => ({ state: 'available', gaps: [] }));
  const result = await buildStudioSemanticSnapshot({ python: python!, codeRoot: process.cwd(), runRoot: root,
    sources: [{ ref, title: '成功退款金额', kind: 'sap-metric', body: JSON.stringify({ name: 'settled_refund_amount', definition: '本期成功退款金额；按退款事件区分' }) }],
    signal: new AbortController().signal, assertCurrent() {}, checkMany: qualify,
  });
  assert.equal(result.counts.nodes, 2);
  assert.deepEqual(result.sourceRefs, [ref]);
  const found = await runSemanticGraphProcess<{ nodes: Array<{ metadata: { sourceRefs: unknown[] } }> }>({ binding: { runRoot: root, snapshotId: result.snapshotId, python: python!, codeRoot: process.cwd() }, query: { action: 'graph', operation: 'find', query: '成功退款' }, signal: new AbortController().signal, assertCurrent() {}, checkMany: qualify });
  assert.ok(found.nodes.length > 0);
  assert.deepEqual(found.nodes[0]?.metadata.sourceRefs, [ref]);
});
