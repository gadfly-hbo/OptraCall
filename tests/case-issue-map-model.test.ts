import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueTree } from '../src/host/ui/case-issue-map-model.ts';

const issue = (id: string, title = id) => ({ id, caseId: 'c', title, createdAt: '2026-01-01T00:00:00.000Z' });
const edge = (id: string, from: string, to: string, lifecycle: 'active' | 'removed' = 'active') => ({ edgeId: id, caseId: 'c', fromIssueId: from, toIssueId: to, revision: 1, lifecycle, explanation: '', source: { kind: 'user-declaration' as const, ref: null }, operationId: id, createdAt: '' });

test('DW03-MODEL-01: no edges means every issue is isolated; title or order never create edges', () => {
  const tree = buildIssueTree([issue('a'), issue('b')], []);
  assert.equal(tree.roots.length, 0); assert.deepEqual(tree.isolated.map(i => i.id), ['a', 'b']);
});

test('DW03-MODEL-02: A→C and B→C converge; C expands once and is a reference under the other predecessor', () => {
  const tree = buildIssueTree([issue('a'), issue('b'), issue('c'), issue('d')], [edge('1', 'a', 'c'), edge('2', 'b', 'c')]);
  assert.deepEqual(tree.roots.map(r => r.issue.id), ['a', 'b']);
  assert.equal(tree.roots[0]!.children[0]!.reference, false);
  assert.equal(tree.roots[1]!.children[0]!.reference, true);
  assert.deepEqual(tree.roots[0]!.children[0]!.predecessors.map(p => p.id), ['a', 'b']);
  assert.deepEqual(tree.isolated.map(i => i.id), ['d']);
});

test('DW03-MODEL-03: loops terminate safely, removed edges are ignored, unknown ends are reported not drawn', () => {
  const loop = buildIssueTree([issue('a'), issue('b')], [edge('1', 'a', 'b'), edge('2', 'b', 'a')]);
  assert.equal(loop.roots.length, 1); assert.equal(loop.roots[0]!.children[0]!.children[0]!.reference, true);
  const gone = buildIssueTree([issue('a'), issue('b')], [edge('1', 'a', 'b', 'removed')]);
  assert.equal(gone.roots.length, 0);
  const dangling = buildIssueTree([issue('a')], [edge('1', 'a', 'zzz')]);
  assert.equal(dangling.dangling.length, 1); assert.deepEqual(dangling.isolated.map(i => i.id), ['a']);
});
