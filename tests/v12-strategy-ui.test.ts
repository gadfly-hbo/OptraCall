import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/register-ui.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
test('V12-05 daily Goal view uses integrated GSA workspace while BSC remains a collapsed optional tool', async () => {
  const { StrategyGoalsPage } = await import('../src/host/ui/StrategyGoalsPage.tsx');
  const html = renderToStaticMarkup(createElement(StrategyGoalsPage, { active: false, management:{area:'gsa',stage:'goals'}, onStage() {}, onOpenCase() {}, onStartProject() {}, onManageMetrics() {} }));
  assert.match(html, /目标管理/);
  assert.doesNotMatch(html, /aria-current="page"[^>]*>目标与策略/);
  assert.doesNotMatch(html, /BSC 目标与关系/);
  const compare = renderToStaticMarkup(createElement(StrategyGoalsPage, {active:false,management:{area:'strategy',stage:'strategy-versions'},onStage(){},onOpenCase(){},onStartProject(){},onManageMetrics(){}}));
  assert.match(compare, /BSC／战略目标关系（按需）/);
  assert.match(compare, /aria-current="page"[^>]*>版本管理/);
  assert.match(compare, />战略共创</); assert.match(compare, />战略检验</); assert.match(compare, />战略发布</);
  assert.doesNotMatch(compare, />战略地图</); assert.doesNotMatch(compare, />战略模拟</); assert.doesNotMatch(compare, />版本与来源</);
});
test('V12-01 Task background displays only its recorded personal context and keeps missing history unknown', async () => {
  const { TaskUsageContextReceipt } = await import('../src/host/ui/TaskUsageContext.tsx');
  const recorded = renderToStaticMarkup(createElement(TaskUsageContextReceipt, { value: { usageContext: { kind: 'personal', background: '原请求中的家庭与事业范围' }, planVersion: 2, confirmationId: 'original-confirmation', text: '当时目标 v1，原范围保留。' } }));
  assert.match(recorded, /个人/); assert.match(recorded, /原请求中的家庭与事业范围/); assert.match(recorded, /当时目标 v1/);
  const legacy = renderToStaticMarkup(createElement(TaskUsageContextReceipt, { value: { planVersion: 1 } }));
  assert.match(legacy, /保持未知/); assert.doesNotMatch(legacy, /本次用途：/);
});
test('a browsed Goal is labelled separately from the discussion binding', async () => {
  const { StrategyDiscussionPanel } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const html = renderToStaticMarkup(createElement(StrategyDiscussionPanel, { active: false, selectedGoal: {
    goalId: 'browsed-goal', version: 1, title: '页面正在浏览的BSC目标', status: 'adopted', createdAt: '2026-11-16T00:00:00Z',
    outcome: '核实所选范围', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人' },
    measurement: { kind: 'deliverable', criterion: '提交结果' }, baseline: { state: 'pending', description: '待核' }, responsible: '本人',
  }, projects: [], configurations: [], onReviewCandidate() {}, onGoalsChanged: async () => {}, onSettings() {} }));
  assert.match(html, /当前浏览目标：页面正在浏览的BSC目标/); assert.doesNotMatch(html, /当前目标：/); assert.doesNotMatch(html, /目标准确版 v1/);
});
