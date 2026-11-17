import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestProjectPlanUsage } from '../src/host/ui/project-plan-usage-context.ts';
import { resolveNewUsageContext } from '../src/host/usage-context-types.ts';
import type { ProjectPlanContent } from '../src/host/project-plan-types.ts';
const empty = (): ProjectPlanContent => ({ request: '原项目', premises: [], materials: [], coverage: [], tasks: [], taskMode: 'single', summaryTaskKey: '', dependencies: [], caseContext: null });
test('an automatic default remains derived when a later exact personal or department Case Goal supplies the background', () => {
  for (const kind of ['personal', 'department'] as const) {
    const draft = suggestProjectPlanUsage(empty(), { kind: 'organization', background: '全局默认' }, 'default');
    const goal = { version: 1, scope: { kind, name: kind === 'personal' ? '本人家庭' : '客服部门' } };
    const changed = suggestProjectPlanUsage(draft, resolveNewUsageContext({ goal }), 'goal');
    assert.deepEqual(changed.usageContext, { kind, background: `${goal.scope.name}；沿目标 v1 的准确范围。` }); assert.equal(changed.usageContextOrigin, 'goal');
    assert.deepEqual(draft.usageContext, { kind: 'organization', background: '全局默认' });
  }
});
test('human and old recorded contexts are preserved while new suggestions carry their origin', () => {
  for (const origin of [undefined, 'explicit'] as const) {
    const prior = { ...empty(), usageContext: { kind: 'personal' as const, background: '已经明确' }, ...(origin ? { usageContextOrigin: origin } : {}) };
    assert.equal(suggestProjectPlanUsage(prior, { kind: 'organization', background: '今日默认' }, 'default'), prior);
  }
});
