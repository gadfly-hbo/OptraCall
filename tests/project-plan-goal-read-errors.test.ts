import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, projectPlanError } from '../src/host/ui/project-plan-client.ts';

test('PG01 UI: exact goal and version read failures identify the original authority and keep the selection', async t => {
  const input = { operationId: '00000000-0000-4000-8000-000000000001', expectedRevision: 0, plan: { request: '沿原目标核对', premises: [], materials: [], coverage: [], tasks: [{ key: 'check', name: '核对', selected: true, scope: '', capabilities: [] }], taskMode: 'single' as const, summaryTaskKey: 'check', dependencies: [], caseContext: null, goalContext: { goal: { goalId: '00000000-0000-4000-8000-000000000002', version: 7 }, purpose: 'query' as const } } };
  const original = structuredClone(input);
  for (const code of ['strategy_goal_not_found', 'strategy_goal_version_not_found']) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ code }), { status: 404, headers: { 'content-type': 'application/json' } }));
    await assert.rejects(prepare('00000000-0000-4000-8000-000000000003', input), error => {
      const message = projectPlanError(error);
      assert.match(message, /目标/); assert.match(message, /不可取得|无法读取/);
      assert.match(message, /保留原选择/); assert.match(message, /未.*替换.*最新/);
      assert.doesNotMatch(message, /核对本地服务/);
      return true;
    });
    assert.deepEqual(input, original);
    t.mock.restoreAll();
  }
});
