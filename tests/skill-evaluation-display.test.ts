import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { catalogItems } from '../src/host/ui/catalog-data.ts';
import { formatAssertionGain, formatMetricValue, formatRate, formatRelativeChange } from '../src/host/ui/skill-evaluation.ts';

test('only the six built-in skill cards carry the shared evaluation slot', () => {
  assert.deepEqual(catalogItems.filter(item => 'skill' in item).map(item => item.id).sort(),
    ['coupon-forecast', 'data-analysis', 'deep-research', 'ppt-report', 'roi-forecast', 'target-forecast']);
});

test('the historical deep-research receipt remains bound to its tested revision and complete sample disposition', () => {
  const evaluation = catalogItems.find(item => item.id === 'deep-research')?.skill?.evaluation;
  assert.ok(evaluation);
  assert.equal(evaluation.testedRevision, 'a78a478');
  assert.equal(evaluation.revisedSinceEvaluation, true);
  assert.equal(evaluation.coversEngineeringRevisions, true);
  assert.match(evaluation.limitations ?? '', /2026-11-04.*30eda70/);
  assert.deepEqual(evaluation.judgments, { wins: 3, ties: 1, losses: 0, undetermined: 6 });
  assert.equal(evaluation.sampleCount, 10);
  assert.equal(catalogItems.find(item => item.id === 'coupon-forecast')?.skill?.evaluation, undefined);
});

test('an explicitly covered engineering revision keeps its provisional verdict without requesting another user evaluation', async t => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' });
  t.after(() => server.close());
  const { SkillEvaluationPanel } = await server.ssrLoadModule('/src/host/ui/SkillEvaluation.tsx');
  const historical = catalogItems.find(item => item.id === 'deep-research')!.skill!.evaluation!;
  const evaluation = { ...historical, coversEngineeringRevisions: true, provisional: true, limitations: '有效但昂贵；1/30 baseline 超时，仍计入分母。' };
  const html = renderToStaticMarkup(createElement(SkillEvaluationPanel, { name: '合成样本', evaluation }));
  assert.match(html, /<summary>.*有效·暂定.*<\/summary>/s);
  assert.match(html, /用户已确认结论覆盖本轮工程修正后的交付版/);
  assert.match(html, /有效但昂贵；1\/30 baseline 超时，仍计入分母。/);
  assert.doesNotMatch(html, /修正版待复测|修正版未复测|原候选测评/);
  assert.doesNotMatch(html.match(/<details[^>]*>/)![0], /\bopen(?:[=\s>])/);

  const acceptedHtml = renderToStaticMarkup(createElement(SkillEvaluationPanel, { name: '深度研究', evaluation: historical }));
  assert.match(acceptedHtml, /用户已确认结论覆盖本轮工程修正后的交付版/);
  assert.doesNotMatch(acceptedHtml, /修正版待复测|修正版未复测|原候选测评/);

  const legacyHtml = renderToStaticMarkup(createElement(SkillEvaluationPanel, { name: '合成未获覆盖回执', evaluation: { ...historical, coversEngineeringRevisions: false } }));
  assert.match(legacyHtml, /修正版待复测/);
  assert.match(legacyHtml, /测评对应原候选；修正版未复测。/);
  assert.doesNotMatch(legacyHtml, /覆盖本轮工程修正后的交付版|暂定/);
});

test('the data-analysis card exposes the approved receipt with unrounded assertion gain and the actual cost and judgment denominators', async t => {
  const item = catalogItems.find(item => item.id === 'data-analysis');
  assert.ok(item, 'The delivered skill must be available in the analysis assets catalog');
  assert.equal(item.category, 'assets');
  assert.equal(item.status, '已接入');
  assert.equal(item.entry, 'data-analysis');
  const evaluation = item.skill?.evaluation;
  assert.ok(evaluation);
  assert.equal(evaluation.testedRevision, '6df72f4（评估归档 1.9.0 · hash 63adebba）');
  assert.equal(evaluation.revisedSinceEvaluation, true);
  assert.equal(evaluation.coversEngineeringRevisions, true);
  assert.equal(evaluation.provisional, true);
  assert.equal(evaluation.sampleCount, 15);
  assert.equal(formatAssertionGain(evaluation.assertions), '+60.7 个百分点');
  assert.equal(formatMetricValue(evaluation.assertions.baseline, 'percent'), '26.8%');
  assert.equal(formatMetricValue(evaluation.assertions.variant, 'percent'), '87.4%');
  assert.equal(formatRate(evaluation.activation.activated, evaluation.activation.total), '100.0%');
  assert.deepEqual(evaluation.judgments, { wins: 11, ties: 3, losses: 0, undetermined: 1 });
  assert.equal(formatRelativeChange(evaluation.seconds), '约 +335%');
  assert.equal(formatRelativeChange(evaluation.tokens), '约 +3912%');

  const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' });
  t.after(() => server.close());
  const { SkillEvaluationPanel } = await server.ssrLoadModule('/src/host/ui/SkillEvaluation.tsx');
  const html = renderToStaticMarkup(createElement(SkillEvaluationPanel, { name: item.name, evaluation }));
  assert.match(html, /78\.6%（11\/14）/);
  assert.match(html, /25\.2 秒 → 109\.7 秒/);
  assert.match(html, /7,048 → 282,738/);
  assert.match(html, /38\/142.*139\/159/);
  assert.match(html, /MiniMax-M3\.1-Flash.*mimo-v2\.6-flash/);
  assert.match(html, /1\/30 baseline 超时/);
  assert.match(html, /50\.8.*68\.5/);
  assert.match(html, /无负向样例.*误触发不可测/);
  assert.match(html, /40\.1 倍/);
  assert.doesNotMatch(html, /修正版待复测|修正版未复测/);
});

test('assertion gains are percentage points while sample rates retain their actual denominators', () => {
  assert.equal(formatAssertionGain({ baseline: 16.2, variant: 29.4 }), '+13.2 个百分点');
  assert.equal(formatAssertionGain({ baseline: 0, variant: 5 }), '+5.0 个百分点');
  assert.equal(formatAssertionGain({ baseline: 29.4, variant: 16.2 }), '-13.2 个百分点');
  assert.equal(formatRate(8, 10), '80.0%');
  assert.equal(formatRate(3, 4), '75.0%');
  assert.equal(formatRelativeChange({ baseline: 278.9, variant: 460.8 }), '约 +65%');
  assert.equal(formatRelativeChange({ baseline: 1_110_000, variant: 1_720_000 }), '约 +55%');
});

test('missing or unusable comparisons do not turn into zero scores, infinity, or NaN', () => {
  for (const input of [{ baseline: null, variant: 29.4 }, { baseline: 16.2, variant: null }, { baseline: NaN, variant: 1 }]) {
    assert.equal(formatAssertionGain(input), '未提供');
    assert.equal(formatRelativeChange(input), '未提供');
  }
  assert.equal(formatRelativeChange({ baseline: 0, variant: 10 }), '未提供');
  assert.equal(formatRate(0, 0), '未提供');
  assert.equal(formatRate(3, 2), '未提供');
  assert.equal(formatRate(1.5, 2), '未提供');
  assert.equal(formatAssertionGain({ baseline: 101, variant: 80 }), '未提供');
  assert.equal(formatMetricValue(null, 'tokens'), '未提供');
  assert.equal(formatMetricValue(1_110_000, 'tokens'), '1.11M');
  assert.equal(formatMetricValue(1_720_000, 'tokens'), '1.72M');
});
