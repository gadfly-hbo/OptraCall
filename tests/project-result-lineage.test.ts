import test from 'node:test';
import assert from 'node:assert/strict';
import { projectResultAncestors } from '../src/host/project-result-lineage.ts';

test('authorized ancestor facts follow the selected native branch and branch summaries, excluding unrelated turns', () => {
  const entries = [
    { id: 'a', type: 'custom', parentId: null },
    { id: 'b', type: 'custom', parentId: 'a' },
    { id: 'unrelated', type: 'custom', parentId: 'a' },
    { id: 'another', type: 'message', parentId: 'b' },
    { id: 'summary', type: 'branch_summary', parentId: 'a', fromId: 'another' },
    { id: 'answer', type: 'message', parentId: 'summary' },
  ];
  assert.deepEqual(new Set(projectResultAncestors(entries, 'answer').map(e => e.id)), new Set(['a','b','another','summary','answer']));
  assert.throws(() => projectResultAncestors(entries, 'missing'));
  assert.throws(() => projectResultAncestors([{ id:'a', parentId:'b',type:'message' }, { id:'b', parentId:'a', type:'message' }], 'a'));
  assert.throws(() => projectResultAncestors(entries, 'answer', 2));
});
