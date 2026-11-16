import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

test('Case HTTP precondition fixture reuses the same adopted exact goal across calls and Host restart', async t => {
  let host = await startTestHost(); t.after(() => host.close());
  const input = { operationId: 'original-case-operation', title: '原业务字段', description: '原范围与断言保持' };
  const first = await withCaseGoal(host, input), second = await withCaseGoal(host, { ...input, title: '另一原Case' });
  assert.deepEqual(first.goalBinding, second.goalBinding);
  assert.deepEqual({ ...first, goalBinding: undefined }, { ...input, goalBinding: undefined });
  assert.deepEqual(input, { operationId: 'original-case-operation', title: '原业务字段', description: '原范围与断言保持' });
  const listing = await (await host.request('/api/strategy/goals')).json();
  assert.equal(listing.goals.length, 1);
  assert.equal(listing.goals[0].versions[0].status, 'adopted');
  const { dataRoot, projectsRoot } = host;
  await host.close(); host = await startTestHost({ dataRoot, projectsRoot });
  const after = await withCaseGoal(host, input);
  assert.deepEqual(after.goalBinding, first.goalBinding);
  assert.equal((await (await host.request('/api/strategy/goals')).json()).goals.length, 1);
});

test('Case HTTP precondition fixture preserves an explicitly supplied binding without reading or replacing it', async () => {
  const existing = { operationId: 'original', title: '明确引用', goalBinding: { primary: { goalId: 'original-goal', version: 7 }, related: [] } };
  const host = { request: async (): Promise<Response> => { throw new Error('Existing bindings must not trigger setup'); } };
  assert.equal(await withCaseGoal(host, existing), existing);
});
