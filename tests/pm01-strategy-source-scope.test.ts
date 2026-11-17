import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyDiscussionSource } from '../src/host/strategy-discussion-sources.ts';
import { isDiscussionSourceExcluded } from '../src/host/strategy-discussion-source-scope.ts';

test('PM-V12-01: excluding an original enterprise wrapper also excludes the same material in the current direct catalogue and later revision', () => {
  const wrapped = createStrategyDiscussionSource('旧经营计划', { kind: 'source', source: { type: 'enterprise', storeId: 'store-a', materialId: 'material-a', revisionId: 'revision-1' } }, 'a'.repeat(64), 'revision-1');
  const direct = createStrategyDiscussionSource('新经营计划', { kind: 'enterprise', storeId: 'store-a', materialId: 'material-a', revisionId: 'revision-2' }, 'b'.repeat(64), 'revision-2');
  const other = createStrategyDiscussionSource('另一企业计划', { kind: 'enterprise', storeId: 'store-b', materialId: 'material-a', revisionId: 'revision-2' }, 'b'.repeat(64), 'revision-2');
  const laterWrapper = createStrategyDiscussionSource('新版包装', { kind: 'source', source: { type: 'enterprise', storeId: 'store-a', materialId: 'material-a', revisionId: 'revision-3' } }, 'c'.repeat(64), 'revision-3');
  const scope = { sourceScope: { mode: 'project-background' as const, excludedSources: [wrapped] } };
  assert.equal(isDiscussionSourceExcluded(scope, direct), true);
  assert.equal(isDiscussionSourceExcluded(scope, laterWrapper), true);
  assert.equal(isDiscussionSourceExcluded(scope, other), false, 'a material in another store is a separate original resource');
  assert.equal(isDiscussionSourceExcluded({ sourceScope: { mode: 'selected-only', excludedSources: [direct] } }, wrapped), true);
});
