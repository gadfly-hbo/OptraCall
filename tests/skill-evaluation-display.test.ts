import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogItems } from '../src/host/ui/catalog-data.ts';
import { formatAssertionGain, formatMetricValue, formatRate, formatRelativeChange } from '../src/host/ui/skill-evaluation.ts';

test('only the five built-in skill cards carry the shared evaluation slot', () => {
  assert.deepEqual(catalogItems.filter(item => 'skill' in item).map(item => item.id).sort(),
    ['coupon-forecast', 'deep-research', 'ppt-report', 'roi-forecast', 'target-forecast']);
});

test('the historical deep-research receipt remains bound to its tested revision and complete sample disposition', () => {
  const evaluation = catalogItems.find(item => item.id === 'deep-research')?.skill?.evaluation;
  assert.ok(evaluation);
  assert.equal(evaluation.testedRevision, 'a78a478');
  assert.equal(evaluation.revisedSinceEvaluation, true);
  assert.deepEqual(evaluation.judgments, { wins: 3, ties: 1, losses: 0, undetermined: 6 });
  assert.equal(evaluation.sampleCount, 10);
  assert.equal(catalogItems.find(item => item.id === 'coupon-forecast')?.skill?.evaluation, undefined);
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
