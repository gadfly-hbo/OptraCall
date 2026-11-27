import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import type { DecompositionDraftInput, ProgressEvidenceBasis } from '../src/host/strategy-goal-decomposition-types.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';

test('PM A3: an Agent scope suggestion is actionable without silently changing a submitted scope or an old check', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'goal-scope-suggestion-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new StrategyGoalsStore(root);
  const metric = '净销售额';
  const goal = store.create({ operationId: randomUUID(), title: '合成范围对照', outcome: '净销售额120万元', perspective: 'profit',
    scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' }, measurement: { kind: 'deliverable', criterion: metric },
    baseline: { state: 'known', description: '合成108万元' }, responsible: '合成负责人', strategies: ['合成计划'],
    formalOrigin: { kind: 'manual-exception', reason: '独立合成测试', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' } });
  const { gsaPlan } = store.confirmGsaPlan(goal.goalId, { operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'A1', summary: '合成核对', checkpoint: '2027-01-14', observationBasis: '合成报表' }], decision: '合成计划' });
  const { draft } = store.saveDecompositionDraft(goal.goalId, makeNormalDraftPayload(gsaPlan) as DecompositionDraftInput);
  const intent = { gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft.revision, draftSha256: draft.contentSha256, expectedActiveVersion: null };
  const preview = store.previewDecompositionPublish(goal.goalId, intent);
  store.publishDecomposition(goal.goalId, { ...intent, operationId: randomUUID(), previewSha256: preview.previewSha256 });
  const period = draft.timePlan[1]!;
  const expected: ProgressEvidenceBasis = { metric, unit: '万元', scope: draft.estimate.scopeDescription, periodId: period.periodId, coverage: 'complete', maturity: 'closed' };
  function record(scope: string, proposedScope = expected.scope, supplementOfCheckId?: string, originalReport?: string) {
    const report = originalReport ?? `截至2027-01-14，${scope}，即本计划完整范围，净销售额27万元，完整已结账。`;
    const input = { operationId: randomUUID(), publicationVersion: 1, rowId: 'G-TOTAL', checkpointId: period.checkpointId!,
      actualSource: { ref: 'synthetic-scope', label: '合成范围报表', cutoffAt: '2027-01-14', reportText: report, basis: { ...expected, scope } },
      actualPeriods: [{ periodId: period.periodId, actualValue: 27 }], ...(supplementOfCheckId ? { supplementOfCheckId } : {}) };
    const { actual } = store.submitActual(goal.goalId, input);
    const result = store.assessSubmittedActual(goal.goalId, actual.actualId, 'comparable', '按原文核对范围', {
      quote: report, actualValue: 27, basis: { ...expected, scope: proposedScope },
      basisMappings: [{ field: 'scope', sourceValue: scope, mappedValue: proposedScope, evidenceQuote: report, rationale: '对照准确计划范围，交负责人核对' }],
    });
    assert.deepEqual(store.readSubmittedActual(goal.goalId, actual.actualId).input, input);
    return result.check!;
  }

  const original = record('仅统计零售事业部全部渠道与门店');
  assert.equal(original.comparability, 'incomparable', 'an Agent suggestion does not override the manual scope');
  assert.equal(original.overallVariancePct, null);
  assert.equal(original.basisSuggestions?.length, 1);
  assert.equal(original.basisSuggestions[0]!.submittedValue, '仅统计零售事业部全部渠道与门店');
  assert.equal(original.basisSuggestions[0]!.proposedValue, expected.scope);

  const unrelated = record('华东门店', '另一个计划的范围');
  assert.equal(unrelated.comparability, 'incomparable');
  assert.equal(unrelated.basisSuggestions, undefined, 'only a suggestion for the selected frozen scope is actionable');
  const narrower = record('华东门店');
  assert.equal(narrower.comparability, 'incomparable', 'even an optimistic expansion stays a proposal until the owner chooses');
  assert.equal(narrower.actualSource.basis?.scope, '华东门店');

  // The existing correction submission creates a new check; it never rewrites the prior evidence.
  const corrected = record(original.basisSuggestions[0]!.proposedValue, expected.scope, original.checkId, original.actualSource.reportText);
  assert.equal(corrected.comparability, 'comparable');
  assert.equal(corrected.overallVariancePct, -10);
  assert.equal(corrected.supplementOfCheckId, original.checkId);
  assert.equal(corrected.actualSource.reportText, original.actualSource.reportText, 'scope confirmation does not rewrite the original report');
  const storedOriginal = store.getGoalWorkspace(goal.goalId).checks.find(c => c.checkId === original.checkId)!;
  assert.deepEqual(storedOriginal, original);
});
