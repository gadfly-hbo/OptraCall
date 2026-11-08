import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticRecordsForAssistant } from '../src/host/ui/semantic-context-history.ts';

const input = { action: 'graph', operation: 'dependencies', nodeId: 'method-v1', depth: 2, pageSize: 20 };
const ref = { kind: 'sap', packageId: 'optracall-sc01s-retail', version: '0.1.0', metricName: 'net_retail_sales', publishedHash: null, sourceHandle: 'original-run-only-source' };
const metadata = { sourceRefs: [ref], buildSources: [{ inputKey: 'approved-design', locator: '/definition', sha256: 'c'.repeat(64), nature: 'engineering-design' }], claimKind: 'source-projection', conditions: ['以原支付归属'], limitations: ['样本截数不等于退款成熟'], businessTime: [{ text: '退款按原支付归属', source: '原制度第二节' }] };
const details = {
  schemaVersion: 1, type: 'optracall.semantic-graph-result', action: 'graph', operation: 'dependencies', state: 'partial',
  snapshot: { id: 'fbaba342-4e0d-41d0-8196-1ee27b34d13c', graphSha256: 'a'.repeat(64), ontologySha256: 'b'.repeat(64), componentVersion: '0.7.0' },
  nodes: [{ id: 'method-v1', type: 'MethodVersion', content: '参考方法：先核可比性，判断仍由 Agent 负责', metadata },
    { id: 'net-v1', type: 'MetricVersion', content: '净零售额 = 终端零售额 − 零售退款额', metadata },
    { id: 'refund-v1', type: 'MetricVersion', content: '退款按原订单支付期间归属', metadata }],
  edges: [{ id: 'method-net', source: 'method-v1', target: 'net-v1', type: 'depends_on', metadata },
    { id: 'net-refund-source', source: 'net-v1', target: 'refund-v1', type: 'depends_on', metadata: { ...metadata, operandRole: 'subtrahend' } },
    { id: 'net-refund-interpretation', source: 'net-v1', target: 'refund-v1', type: 'depends_on', metadata: { ...metadata, claimKind: 'engineering-interpretation', operandRole: 'subtrahend' } }],
  paths: [{ nodeIds: ['method-v1', 'net-v1', 'refund-v1'], steps: [{ edgeId: 'method-net', direction: 'forward' }, { edgeId: 'net-refund-source', direction: 'forward' }] },
    { nodeIds: ['method-v1', 'net-v1', 'refund-v1'], steps: [{ edgeId: 'method-net', direction: 'forward' }, { edgeId: 'net-refund-interpretation', direction: 'forward' }] }],
  sources: [], coverage: { complete: false, continuation: 'original-run-only-cursor', gaps: ['source-validation-gap'], depthLimit: 2, depthReached: 2, exhausted: false },
};
const messages = [
  { role: 'user', content: '请核实两期净零售额的口径' },
  { role: 'assistant', content: [{ type: 'toolCall', id: 'graph-original', name: 'read_semantic_context', arguments: input }] },
  { role: 'toolResult', toolName: 'read_semantic_context', toolCallId: 'graph-original', entryId: 'native-graph-entry', details, content: [{ type: 'text', text: JSON.stringify(details) }] },
  { role: 'assistant', content: '原支付归属与退款成熟需要分开解释。' },
];

test('saved graph records preserve the actual parameters, semantic payload and native identity without L1 replacement', t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('No passive lookup'); });
  const before = JSON.stringify(messages);
  const rows = semanticRecordsForAssistant(messages, 3, 'original-session');
  const row = rows[0] as Record<string, any>;
  assert.equal(rows.length, 1);
  assert.deepEqual(row.graphResult, details);
  assert.deepEqual(row.graphInput, input);
  assert.equal(row.result, undefined);
  assert.equal(row.input, undefined);
  assert.equal(row.issue, undefined);
  assert.deepEqual(row.native, { sessionId: 'original-session', entryId: 'native-graph-entry', toolCallId: 'graph-original' });
  assert.equal(row.graphResult.paths.length, 2, 'parallel provenance paths must remain distinct');
  assert.equal(JSON.stringify(messages), before);
  assert.equal(requests, 0);
});

test('malformed graph content and inconsistent path identity stay UNKNOWN rather than become an empty ready graph', () => {
  for (const change of [
    { nodes: null }, { schemaVersion: 2 }, { paths: [{ nodeIds: ['net-v1', 'refund-v1'], steps: [{ edgeId: 'missing-edge', direction: 'forward' }] }] },
    { paths: [{ nodeIds: ['refund-v1', 'net-v1'], steps: [{ edgeId: 'net-refund-source', direction: 'forward' }] }] },
    { nodes: [{ ...details.nodes[0], type: 'UnapprovedType' }] },
    { nodes: [{ ...details.nodes[0], metadata: { ...metadata, rawPath: '/private/disallowed' } }] },
  ]) {
    const transcript: Record<string, any>[] = structuredClone(messages);
    transcript[2]!.details = { ...details, ...change };
    const row = semanticRecordsForAssistant(transcript, 3, 'original-session')[0] as Record<string, any>;
    assert.equal(row.graphResult, undefined);
    assert.equal(row.result, undefined);
    assert.match(row.issue, /UNKNOWN/);
  }
});

test('nested graph metadata does not invent a child result, replay a handle or backfill from text JSON', () => {
  const nested = [messages[0]!, messages[1]!, { role: 'toolResult', toolName: 'codemode', toolCallId: 'parent', entryId: 'parent-entry', details,
    content: [{ type: 'text', text: JSON.stringify(details) }], nestedCalls: { calls: [{ name: 'read_semantic_context', arguments: JSON.stringify(input), status: 'ok' }] } }, messages[3]!];
  const row = semanticRecordsForAssistant(nested, 3, 'original-session')[0] as Record<string, any>;
  assert.equal(row.graphResult, undefined);
  assert.deepEqual(row.graphInput, input);
  assert.match(row.issue, /子工具正文.*UNKNOWN/);
  const newTurn = [...messages, { role: 'user', content: '另一个问题' }, { role: 'assistant', content: '普通回复' }];
  assert.deepEqual(semanticRecordsForAssistant(newTurn, 5), []);
});

test('graph errors, a missing details payload and unrelated tools cannot masquerade as saved semantic delivery', () => {
  for (const change of [{ isError: true }, { details: undefined }]) {
    const transcript = structuredClone(messages); Object.assign(transcript[2]!, change);
    const row = semanticRecordsForAssistant(transcript, 3)[0] as Record<string, any>;
    assert.equal(row.graphResult, undefined); assert.match(row.issue, /UNKNOWN/);
  }
  const other = structuredClone(messages); other[2]!.toolName = 'bash';
  assert.deepEqual(semanticRecordsForAssistant(other, 3), []);
});
