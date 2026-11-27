import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import type { DecompositionDraftInput } from '../src/host/strategy-goal-decomposition-types.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';

function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'goal-unit-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new StrategyGoalsStore(root);
  const metric = '2027年1月全渠道净销售额';
  const goal = store.create({ operationId: randomUUID(), title: '合成单位换算边界', outcome: '净销售额120万元', perspective: 'profit',
    scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' }, measurement: { kind: 'deliverable', criterion: metric },
    baseline: { state: 'known', description: '合成108万元' }, responsible: '合成负责人', strategies: ['合成计划'],
    formalOrigin: { kind: 'manual-exception', reason: '独立合成测试', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' } });
  const { gsaPlan } = store.confirmGsaPlan(goal.goalId, { operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'A1', summary: '合成核对', checkpoint: '2027-01-14', observationBasis: '合成报表' }], decision: '合成计划' });
  const { draft } = store.saveDecompositionDraft(goal.goalId, makeNormalDraftPayload(gsaPlan) as DecompositionDraftInput);
  const intent = { gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft.revision, draftSha256: draft.contentSha256, expectedActiveVersion: null };
  const preview = store.previewDecompositionPublish(goal.goalId, intent);
  const { publication } = store.publishDecomposition(goal.goalId, { ...intent, operationId: randomUUID(), previewSha256: preview.previewSha256 });
  const period = publication.snapshot.timePlan[1]!;
  const basis = { metric, unit: '万元', scope: draft.estimate.scopeDescription, periodId: period.periodId, coverage: 'complete' as const, maturity: 'closed' as const };
  function assess(params: { report: string; value: number; sourceUnit: string; convertedValue: number; factor: number; submittedUnit?: string; evidenceQuote?: string }) {
    const input = { operationId: randomUUID(), publicationVersion: 1, rowId: 'G-TOTAL', checkpointId: period.checkpointId!,
      actualSource: { ref: 'synthetic-unit-report', label: '合成单位报表', cutoffAt: '2027-01-14', reportText: params.report,
        ...(params.submittedUnit === undefined ? {} : { basis: { ...basis, unit: params.submittedUnit } }) },
      actualPeriods: [{ periodId: period.periodId, actualValue: params.value }] };
    const { actual } = store.submitActual(goal.goalId, input);
    const run = () => store.assessSubmittedActual(goal.goalId, actual.actualId, 'comparable', '合成核对', {
      quote: params.report, actualValue: params.convertedValue, basis,
      unitConversion: { sourceValue: params.value, sourceUnit: params.sourceUnit, convertedValue: params.convertedValue, convertedUnit: '万元', factor: params.factor,
        evidenceQuote: params.evidenceQuote ?? params.report, rationale: '合成换算，仅核边界' },
    });
    return { run, original: input, readOriginal: () => store.readSubmittedActual(goal.goalId, actual.actualId).input,
      checkCount: () => store.getGoalWorkspace(goal.goalId).checks.length };
  }
  return { assess };
}

test('PM R1: a declared conversion source unit must belong to the quoted measurement when the submitter left its unit unknown', t => {
  const { assess } = fixture(t);
  for (const report of ['净销售额27元，完整出数并已结账。', '净销售额27万元，完整出数并已结账。']) {
    const f = assess({ report, value: 27, sourceUnit: '亿元', convertedValue: 270000, factor: 10000 });
    const count = f.checkCount();
    assert.throws(f.run, /actual_report_value_mismatch|invalid_progress_evidence/, 'a valid arithmetic factor cannot prove a made-up source unit');
    assert.equal(f.checkCount(), count, 'rejected conversion cannot create a partial check');
    assert.deepEqual(f.readOriginal(), f.original);
  }
  const clipped = assess({ report: '实绩270000元 / 人，完整已结账。', value: 270000, sourceUnit: '元', submittedUnit: '元', convertedValue: 27, factor: 0.0001, evidenceQuote: '270000元' });
  assert.throws(clipped.run, /actual_report_value_mismatch|invalid_progress_evidence/, 'a clipped quote cannot hide the rest of a compound source unit');
  const partialNumber = assess({ report: '实绩270000元，完整已结账。', value: 27, sourceUnit: '元', submittedUnit: '元', convertedValue: 0.0027, factor: 0.0001, evidenceQuote: '27' });
  assert.throws(partialNumber.run, /actual_report_value_mismatch|invalid_progress_evidence/, 'a quote cannot select only the first digits of the source value');
});

test('PM R1: cross-dimension or unverified unit factors cannot become comparable sales by arithmetic alone', t => {
  const { assess } = fixture(t);
  for (const unit of ['人', '袋']) {
    const f = assess({ report: `实绩270000${unit}，完整出数并已结账。`, value: 270000, sourceUnit: unit, submittedUnit: unit, convertedValue: 27, factor: 0.0001 });
    const count = f.checkCount();
    assert.throws(f.run, /actual_report_value_mismatch|invalid_progress_evidence/, 'unknown scale is not a verified conversion');
    assert.equal(f.checkCount(), count);
    assert.deepEqual(f.readOriginal(), f.original);
  }
  for (const report of ['实绩270000元/人，完整已结账。', '实绩270000元 / 人，完整已结账。', '实绩270000元\n/ 人，完整已结账。', '实绩270000元　／　人，完整已结账。', '实绩270000元·人，完整已结账。', '实绩270000元²，完整已结账。']) {
    const compound = assess({ report, value: 270000, sourceUnit: '元', submittedUnit: '元', convertedValue: 27, factor: 0.0001 });
    assert.throws(compound.run, /actual_report_value_mismatch|invalid_progress_evidence/, 'a quoted per-person rate is not a plain currency scale');
  }
});

test('PM R1: known money conversion works from a quoted value/unit pair without asking the user to retype metadata', t => {
  const { assess } = fixture(t);
  for (const report of ['净销售额270000元，完整出数并已结账。', '净销售额270,000 元，完整出数并已结账。', '净销售额270000元 total sales, closed.']) {
    const f = assess({ report, value: 270000, sourceUnit: '元', convertedValue: 27, factor: 0.0001 });
    const res = f.run();
    assert.equal(res.check?.comparability, 'comparable');
    assert.equal(res.check?.overallAbsoluteDiff, -3);
    assert.equal(res.check?.overallVariancePct, -10);
    assert.deepEqual(f.readOriginal(), f.original, 'the submitted source value stays 270000');
  }
});

test('PM R1: a report with no quoted unit can use the submitter\'s explicit original unit, while an unknown original unit stays unverified', t => {
  const { assess } = fixture(t);
  const report = '净销售额270000，完整出数并已结账。';
  const known = assess({ report, value: 270000, sourceUnit: '元', submittedUnit: '元', convertedValue: 27, factor: 0.0001 });
  assert.equal(known.run().check?.comparability, 'comparable');
  const unknown = assess({ report, value: 270000, sourceUnit: '元', convertedValue: 27, factor: 0.0001 });
  assert.throws(unknown.run, /actual_report_value_mismatch|invalid_progress_evidence/);
});
