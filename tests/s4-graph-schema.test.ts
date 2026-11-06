import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { parseSemanticGraphQuery, semanticGraphParameters } from '../extensions/business-plugins/semantic-context/graph.ts';

test('D13 graph parameters expose exactly the six approved operation shapes', () => {
  const queries = [
    { action: 'graph', operation: 'find', query: 'C03', nodeTypes: ['MetricVersion', 'Condition'] },
    { action: 'graph', operation: 'definition', nodeId: 'MetricVersion:exact-id' },
    { action: 'graph', operation: 'neighbors', nodeId: 'node', relationTypes: ['depends_on', 'version_of'], direction: 'both' },
    { action: 'graph', operation: 'dependencies', nodeId: 'method', depth: 4 },
    { action: 'graph', operation: 'impact', nodeId: 'field', depth: 1 },
    { action: 'graph', operation: 'source', sourceHandle: 'opaque-run-handle' },
  ];
  for (const query of queries) {
    assert.equal(Value.Check(semanticGraphParameters, query), true);
    assert.equal(parseSemanticGraphQuery(query).operation, query.operation);
  }
});

test('normalization is deterministic, preserves source handles, and makes defaults explicit', () => {
  assert.deepEqual(parseSemanticGraphQuery({ action: 'graph', operation: 'find', query: '  C03  ' }),
    { action: 'graph', operation: 'find', query: 'c03', pageSize: 20, continuation: null });
  assert.deepEqual(parseSemanticGraphQuery({ action: 'graph', operation: 'neighbors', nodeId: 'node' }),
    { action: 'graph', operation: 'neighbors', nodeId: 'node', direction: 'both', pageSize: 20, continuation: null });
  const impact = parseSemanticGraphQuery({ action: 'graph', operation: 'impact', nodeId: 'node' });
  assert.equal(impact.operation === 'impact' && impact.depth, 2);
  const source = parseSemanticGraphQuery({ action: 'graph', operation: 'source', sourceHandle: ' DoNotNormalize ' });
  assert.equal(source.operation === 'source' && source.sourceHandle, ' DoNotNormalize ');
});

test('schema and Host parser reject extra fields, roots, arbitrary code, duplicate filters and bounds', () => {
  const base = { action: 'graph', operation: 'find', query: 'C03' };
  const bad = [
    { ...base, projectId: 'forged' }, { ...base, taskId: 'forged' }, { ...base, runRoot: '/tmp/private' },
    { ...base, snapshotId: 'forged' }, { ...base, code: 'read files' }, { ...base, recordedBefore: '2026-01-01T00:00:00Z' },
    { ...base, asOf: 'now' }, { ...base, nodeId: 'irrelevant' }, { ...base, nodeTypes: ['Condition', 'Condition'] },
    { ...base, nodeTypes: ['Unapproved'] }, { ...base, pageSize: 0 }, { ...base, pageSize: 101 },
    { ...base, pageSize: 1.5 }, { ...base, continuation: '' }, { ...base, query: 'x\0y' }, { ...base, query: 'a'.repeat(201) },
    { action: 'graph', operation: 'definition' }, { action: 'graph', operation: 'source', sourceHandle: '/x\0y' },
    { action: 'graph', operation: 'impact', nodeId: 'node', depth: 5 },
    { action: 'graph', operation: 'impact', nodeId: 'node', depth: true },
    { action: 'graph', operation: 'neighbors', nodeId: 'node', direction: 'reverse' },
    { action: 'graph', operation: 'neighbors', nodeId: 'node', direction: ['out'] },
    { action: 'graph', operation: ['definition'], nodeId: 'node' },
    { action: 'graph', operation: 'neighbors', nodeId: 'node', relationTypes: ['depends_on', 'depends_on'] },
    { action: 'graph', operation: 'source', sourceHandle: 'x'.repeat(4097) },
    { action: 'graph', operation: 'cypher', query: 'MATCH anything' },
  ];
  for (const query of bad) {
    assert.equal(Value.Check(semanticGraphParameters, query), false, JSON.stringify(query));
    assert.throws(() => parseSemanticGraphQuery(query), { code: 'invalid_semantic_graph_request' }, JSON.stringify(query));
  }
  assert.throws(() => parseSemanticGraphQuery({ ...base, query: '   ' }), { code: 'invalid_semantic_graph_request' });
});

test('normalization copies filters so caller mutations cannot change normalized query binding', () => {
  const nodeTypes = ['Condition'] as const;
  const input = { action: 'graph', operation: 'find', query: 'unknown', nodeTypes: [...nodeTypes] };
  const parsed = parseSemanticGraphQuery(input);
  input.nodeTypes.length = 0;
  assert.deepEqual(parsed.operation === 'find' && parsed.nodeTypes, ['Condition']);
});
