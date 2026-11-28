import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/register-ui.ts';

const { projectCompactIssueGraph } = await import('../src/host/ui/CompactCaseIssueGraph.tsx');

const issue = (id: string, title = id) => ({ id, caseId: 'c', title, createdAt: '2026-01-01T00:00:00.000Z' });
const edge = (id: string, from: string, to: string, lifecycle: 'active' | 'removed' = 'active') => ({ edgeId: id, caseId: 'c', fromIssueId: from, toIssueId: to, revision: 1, lifecycle, explanation: '', source: { kind: 'user-declaration' as const, ref: null }, operationId: id, createdAt: '' });

test('DW03-MODEL-01: no edges means every issue is isolated; title or order never create edges', () => {
  const graph = projectCompactIssueGraph('c', [issue('a'), issue('b')], []);
  assert.equal(graph.nodes.length, 0); assert.deepEqual(graph.isolated.map(i => i.id), ['a', 'b']);
});

test('DW03-MODEL-02: A→C and B→C converge; C appears once and both original predecessors remain', () => {
  const graph = projectCompactIssueGraph('c', [issue('a'), issue('b'), issue('c'), issue('d')], [edge('1', 'a', 'c'), edge('2', 'b', 'c')]);
  assert.deepEqual(graph.nodes.map(i => i.id), ['a', 'b', 'c']);
  assert.deepEqual(graph.edges.map(e => [e.fromIssueId, e.toIssueId]), [['a', 'c'], ['b', 'c']]);
  assert.deepEqual(graph.incoming.get('c')!.map(e => e.fromIssueId), ['a', 'b']);
  assert.deepEqual(graph.isolated.map(i => i.id), ['d']);
});

test('DW03-MODEL-03: loops terminate safely, removed edges are ignored, unknown ends are reported not drawn', () => {
  const loop = projectCompactIssueGraph('c', [issue('a'), issue('b')], [edge('1', 'a', 'b'), edge('2', 'b', 'a')]);
  assert.deepEqual(loop.nodes.map(i => i.id), ['a', 'b']);
  assert.deepEqual(loop.edges.map(e => [e.fromIssueId, e.toIssueId]), [['a', 'b'], ['b', 'a']]);
  assert.equal(loop.hasBackReference, true);
  const gone = projectCompactIssueGraph('c', [issue('a'), issue('b')], [edge('1', 'a', 'b', 'removed')]);
  assert.equal(gone.nodes.length, 0); assert.equal(gone.edges.length, 0);
  const dangling = projectCompactIssueGraph('c', [issue('a')], [edge('1', 'a', 'zzz')]);
  assert.equal(dangling.dangling.length, 1); assert.deepEqual(dangling.isolated.map(i => i.id), ['a']);
});
