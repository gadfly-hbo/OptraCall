import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const server = createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
after(async () => { await (await server).close(); });
test('V12-05 daily Goal view uses GSA while BSC remains a collapsed optional tool', async () => {
  const { StrategyGoalsPage } = await (await server).ssrLoadModule('/src/host/ui/StrategyGoalsPage.tsx');
  const html = renderToStaticMarkup(createElement(StrategyGoalsPage, { active: false, onOpenCase() {}, onStartProject() {}, onManageMetrics() {} }));
  assert.match(html, /aria-current="page"[^>]*>GSA承接/);
  assert.match(html, /<details[^>]*>[\s\S]*?<summary>按需工具/);
  assert.doesNotMatch(html, /<details[^>]*open[^>]*>[\s\S]*?<summary>按需工具/);
  assert.match(html, /BSC／战略目标关系/);
});
test('V12-01 Task background displays only its recorded personal context and keeps missing history unknown', async () => {
  const { TaskUsageContextReceipt } = await (await server).ssrLoadModule('/src/host/ui/TaskUsageContext.tsx');
  const recorded = renderToStaticMarkup(createElement(TaskUsageContextReceipt, { value: { usageContext: { kind: 'personal', background: '原请求中的家庭与事业范围' }, planVersion: 2, confirmationId: 'original-confirmation', text: '当时目标 v1，原范围保留。' } }));
  assert.match(recorded, /个人/); assert.match(recorded, /原请求中的家庭与事业范围/); assert.match(recorded, /当时目标 v1/);
  const legacy = renderToStaticMarkup(createElement(TaskUsageContextReceipt, { value: { planVersion: 1 } }));
  assert.match(legacy, /保持未知/); assert.doesNotMatch(legacy, /本次用途：/);
});
test('a browsed Goal is labelled separately from the discussion binding', async () => {
  const { StrategyDiscussionPanel } = await (await server).ssrLoadModule('/src/host/ui/StrategyDiscussionPanel.tsx');
  const html = renderToStaticMarkup(createElement(StrategyDiscussionPanel, { active: false, selectedGoal: { goalId: 'browsed-goal', version: 1, title: '页面正在浏览的BSC目标' }, projects: [], configurations: [], onReviewCandidate() {}, onGoalsChanged: async () => {}, onSettings() {} }));
  assert.match(html, /当前浏览目标：页面正在浏览的BSC目标/); assert.doesNotMatch(html, /当前目标：/); assert.doesNotMatch(html, /目标准确版 v1/);
});
