import test from 'node:test';
import assert from 'node:assert/strict';
import * as semantic from '../src/host/studio-semantic.ts';
import type { StudioRuleCommand } from '../src/host/studio-rule-reasoning.ts';

const python = process.env.OPTRACALL_STUDIO_TEST_PYTHON;
export function ruleCommand(): StudioRuleCommand {
  const ref = { authority: 'data' as const, id: 'synthetic', version: '1', sha256: 'a'.repeat(64) };
  const predicates = ['Member', 'Normal', 'Eligible'].map(predicate => ({ predicate, namespace: 'https://example.invalid/rules/', itemId: predicate.toLowerCase(), arguments: [{ name: 'member', itemId: 'member', valueType: 'code' }] }));
  return { type: 'reason', execution: { contractVersion: 'studio-rule-execution/1', engine: { name: 'semantica', version: '0.7.0' }, rules: [{ ruleId: 'normal', ruleItemId: 'eligibility', conditions: ['Member(?m)', 'Normal(?m)'], conclusion: 'Eligible(?m)' }], predicates, factRequirements: ['Member', 'Normal'].map(predicate => ({ requirementId: predicate, predicate, sourceRef: ref, bindingRef: ref, fields: ['member'], grain: 'one relationship', unit: 'relationship', timeBasis: 'fixed synthetic period', coverage: 'finite synthetic input', kind: 'observed' })) }, facts: ['Member(member_1)', 'Normal(member_1)'].map((statement, i) => ({ factId: `f${i}`, statement, requirementId: i ? 'Normal' : 'Member', sourceRefs: [ref], locator: `/records/${i}`, kind: 'observed', bindingRef: ref })), targets: [{ targetId: 'member_1', positive: 'Eligible(member_1)' }], coverage: { complete: true, detail: 'Two exact synthetic observations', cutoffAt: '2026-11-13T00:00:00Z', businessTime: 'synthetic-period', missingRequirementIds: [] }, budget: { maxRules: 32, maxFacts: 256, maxConclusions: 512, maxIterations: 32 } };
}

test('RR05/RR07: the original cancellable worker executes official rules without an LLM or graph', { skip: !python, timeout: 30000 }, async () => {
  let cleanup: unknown;
  const result = await (semantic as any).runStudioRuleInference({ python, codeRoot: process.cwd(), command: ruleCommand(), signal: new AbortController().signal, assertCurrent() {}, registerCleanup(fn: unknown) { cleanup = fn; } });
  assert.equal(result.completion, 'complete');
  assert.equal(result.engineInvoked, true);
  assert.equal(result.conclusions[0].statement, 'Eligible(member_1)');
  assert.equal(result.assessments[0].state, 'derived');
  assert.equal(typeof cleanup, 'function');
});
