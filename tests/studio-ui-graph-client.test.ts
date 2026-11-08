import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSemanticGraphResult, isSemanticQueryResult } from '../src/host/ui/semantic-context-client.ts';

const ref = { kind: 'studio-source', systemId: 'retail-system', assetId: 'refund-rule', version: '2', projectId: 'retail-project', publishedHash: 'a'.repeat(64), sourceHandle: 'historical-handle' };
const metadata = { sourceRefs: [ref], buildSources: [], claimKind: 'source-projection', conditions: ['退款归属原订单'], limitations: ['未核实跨店退款'], businessTime: [], predicate: '按原订单归属' };
const graph = () => ({ schemaVersion: 1, type: 'optracall.semantic-graph-result', action: 'graph', operation: 'neighbors', state: 'partial', snapshot: null,
  nodes: [{ id: 'refund', type: 'Statement', content: '退款认定', metadata }, { id: 'order', type: 'Statement', content: '原订单', metadata }],
  edges: [{ id: 'refund-order', source: 'refund', target: 'order', type: 'asserted_relation', metadata }], paths: [], sources: [],
  coverage: { complete: false, continuation: 'historical-cursor', gaps: ['尚需业务核对'] },
});

test('saved graph accepts exact published Studio source identity and asserted predicate without activating it', () => {
  assert.equal(isSemanticGraphResult(graph()), true);
  const l1 = { schemaVersion: 1, type: 'optracall.semantic-context-result', action: 'read', state: 'available', items: [{ target: ref }], unknownTime: [], indexRevision: 1, coverage: { complete: true, continuation: null, gaps: [] } };
  assert.equal(isSemanticQueryResult(l1), false, 'Studio graph refs do not become L1 read targets');
});

test('Studio graph history rejects partial identities, invalid publication hashes and forged predicate metadata', () => {
  for (const field of ['systemId', 'assetId', 'version', 'projectId', 'publishedHash']) {
    const result = structuredClone(graph()); delete (result.nodes[0]!.metadata.sourceRefs[0] as Record<string, unknown>)[field];
    assert.equal(isSemanticGraphResult(result), false, field);
  }
  const invalidHash = structuredClone(graph()); invalidHash.nodes[0]!.metadata.sourceRefs[0]!.publishedHash = 'latest';
  assert.equal(isSemanticGraphResult(invalidHash), false);
  const invalidPredicate = structuredClone(graph()); (invalidPredicate.edges[0]!.metadata as Record<string, unknown>).predicate = { executes: true };
  assert.equal(isSemanticGraphResult(invalidPredicate), false);
  const extraAuthority = structuredClone(graph()); (extraAuthority.nodes[0]!.metadata.sourceRefs[0] as Record<string, unknown>).currentReadAllowed = true;
  assert.equal(isSemanticGraphResult(extraAuthority), false);
});

test('v2 graph provenance preserves actual extraction method and weak assertions as typed display facts', () => {
  const result = graph(); Object.assign(result.edges[0]!.metadata, { weak: true, actualMethod: 'official-component-extract', assetKind: 'rule' });
  assert.equal(isSemanticGraphResult(result), true);
  const wrongWeak = structuredClone(result); (wrongWeak.edges[0]!.metadata as Record<string, unknown>).weak = 'confirmed';
  assert.equal(isSemanticGraphResult(wrongWeak), false);
  const noPredicate = graph(); delete (noPredicate.edges[0]!.metadata as Record<string, unknown>).predicate;
  assert.equal(isSemanticGraphResult(noPredicate), false, 'an asserted relation without its predicate is not displayable as a valid v2 relation');
});
