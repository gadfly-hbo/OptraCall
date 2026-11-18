import { parseFoundationContent, type FoundationRuleExecution } from '../../extensions/business-plugins/studio/foundation.ts';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import { StudioError } from '../../extensions/business-plugins/studio/store.ts';
import { sourceRef, digest, object, text } from '../../extensions/business-plugins/studio/validation.ts';
import type { SemanticContextCallContext } from '../agent/semantic-context.ts';
import type { StudioSourceRead } from './studio-sources.ts';

export const STUDIO_RULE_BUDGET = Object.freeze({ maxRules: 32, maxFacts: 256, maxConclusions: 512, maxIterations: 32 });
export type StudioRuleFact = { factId: string; statement: string; requirementId: string; sourceRefs: StudioSourceRef[]; locator: string; kind: 'observed' | 'external-computation'; bindingRef: StudioSourceRef };
export type StudioRuleTarget = { targetId: string; positive: string; negative?: string };
export type StudioRuleCommand = {
  type: 'reason'; execution: FoundationRuleExecution; facts: StudioRuleFact[]; targets: StudioRuleTarget[];
  coverage: { complete: boolean; detail: string; cutoffAt: string; businessTime: string; missingRequirementIds: string[] };
  budget: typeof STUDIO_RULE_BUDGET;
};
export type StudioRuleResult = {
  completion: 'complete' | 'incomplete' | 'unsupported' | 'cancelled' | 'failed';
  component: { name: 'semantica'; version: '0.7.0' }; contractVersion: 'studio-rule-execution/1';
  conclusions: Array<{ statement: string; ruleId: string; ruleItemId?: string; premises: string[]; confidence?: number; provenanceCompleteness?: string; premisesNature?: string }>;
  assessments: Array<{ targetId: string; state: 'derived' | 'explicit-negative' | 'insufficient-facts' | 'conflict' | 'not-derived' }>;
  constraints?: Record<string, unknown>; limitations: string[]; provenanceQuality?: string; processed?: Record<string, unknown>; engineInvoked?: boolean;
};
export type StudioRuleReceipt = StudioRuleResult & {
  engineInvoked: boolean;
  inputCoverage?: StudioRuleCommand['coverage']; factEvidence?: StudioRuleFact[];
  identity: { requestId: string; operationId: string; enterpriseId?: string; projectId: string; taskId: string; purpose: string; ruleRef: StudioSourceRef; ruleItemIds: string[]; factsRef?: StudioSourceRef; sourceRefs: StudioSourceRef[]; inputFingerprint: string; contractVersion: 'studio-rule-execution/1'; engine: { name: 'semantica'; version: '0.7.0' } };
  factVerification: 'agent-projection-not-independent-verification';
};
export type StudioRuleOptions = {
  projectId: string; taskId: string; enterpriseId?: string; construction: boolean;
  read(ref: StudioSourceRef): Promise<StudioSourceRead>;
  execute?(command: StudioRuleCommand, context: SemanticContextCallContext): Promise<StudioRuleResult>;
};
const empty = (completion: StudioRuleResult['completion'], limitation: string): StudioRuleResult => ({ completion, component: { name: 'semantica', version: '0.7.0' }, contractVersion: 'studio-rule-execution/1', conclusions: [], assessments: [], limitations: [limitation] });
function invalid(): never { throw new StudioError('invalid_studio_rule_facts', 400); }
const keys = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(k => !allowed.includes(k))) invalid(); };

/** Accurate source projection only. All inference is delegated to the official worker. */
export async function reasonWithStudioSources(options: StudioRuleOptions, payload: Record<string, unknown>, context: SemanticContextCallContext): Promise<StudioRuleReceipt> {
  const current = () => { context.assertCurrent(); context.signal.throwIfAborted(); };
  current();
  keys(payload, ['ref', 'itemId', 'purpose', 'factsRef']);
  const ref = sourceRef(payload.ref), itemId = text(payload.itemId, 1000, false), purpose = text(payload.purpose, 1000, false);
  if (ref.authority !== 'studio-source' || !ref.sha256) throw new StudioError('studio_rule_exact_source_required', 400);
  const reads = new Map<string, StudioSourceRef>();
  const read = async (r: StudioSourceRef) => { current(); const result = await options.read(r); current(); if (!result.complete || !result.ref.sha256) throw new StudioError('studio_rule_incomplete_source', 409); reads.set(digest(result.ref), result.ref); if (reads.size > 32) throw new StudioError('studio_rule_source_limit', 413); return result; };
  const original = await read(ref), parsed = parseFoundationContent(original.text);
  const operationId = digest(['studio-reason', options.projectId, options.taskId, context.requestId, context.sessionId, context.toolCallId]);
  let command: StudioRuleCommand | undefined, factsRef: StudioSourceRef | undefined;
  const receipt = async (result: StudioRuleResult, engineInvoked: boolean): Promise<StudioRuleReceipt> => {
    for (const r of [...reads.values()]) await read(r);
    current();
    const identity: StudioRuleReceipt['identity'] = { requestId: context.requestId, operationId, ...(options.enterpriseId ? { enterpriseId: options.enterpriseId } : {}), projectId: options.projectId, taskId: options.taskId, purpose, ruleRef: original.ref, ruleItemIds: parsed.kind === 'supported' ? parsed.profile!.ruleExecution?.rules.map(r => r.ruleItemId) ?? [] : [], ...(factsRef ? { factsRef } : {}), sourceRefs: [...reads.values()], inputFingerprint: digest({ ref: original.ref, purpose, itemId, ...(command ? { command } : {}) }), contractVersion: 'studio-rule-execution/1', engine: { name: 'semantica', version: '0.7.0' } };
    const value: StudioRuleReceipt = { ...result, engineInvoked, identity, ...(command ? { inputCoverage: command.coverage, factEvidence: command.facts } : {}), factVerification: 'agent-projection-not-independent-verification' };
    if (JSON.stringify(value).length > 28_000) {
      const totals = { conclusions: value.conclusions.length, assessments: value.assessments.length };
      value.completion = 'incomplete'; value.limitations = [...value.limitations, `Receipt output budget reached; original result counts: ${JSON.stringify(totals)}. Returned conclusions/assessments are partial, never a complete count.`];
      while (JSON.stringify(value).length > 28_000 && (value.factEvidence?.length || value.conclusions.length || value.assessments.length)) {
        if (value.factEvidence?.length) value.factEvidence = value.factEvidence.slice(0, -1);
        else if (value.conclusions.length) value.conclusions = value.conclusions.slice(0, -1); else value.assessments = value.assessments.slice(0, -1);
      }
      if (JSON.stringify(value).length > 28_000) throw new StudioError('studio_rule_receipt_limit', 413);
    }
    return value;
  };
  if (parsed.kind !== 'supported' || parsed.profile?.contentProfile !== 'studio-foundation/2' || !parsed.profile.ruleExecution) return receipt(empty('unsupported', 'This exact source has no supported executable projection. Its original definition remains readable; the engine was not invoked.'), false);
  const execution = parsed.profile.ruleExecution;
  if (!execution.rules.some(r => r.ruleItemId === itemId)) throw new StudioError('studio_rule_item_not_found', 404);
  for (const requirement of execution.factRequirements) {
    const binding = await read(requirement.bindingRef);
    if (requirement.bindingRef.authority !== 'data' && binding.assetKind !== 'binding') throw new StudioError('studio_rule_binding_mismatch', 409);
    await read(requirement.sourceRef);
    for (const ref of requirement.calculationRefs ?? []) await read(ref);
  }
  factsRef = sourceRef(payload.factsRef);
  if (factsRef.authority !== 'data' || factsRef.projectId !== options.projectId || !factsRef.locator?.startsWith('020_clean/') || !factsRef.sha256 || factsRef.version !== factsRef.sha256) throw new StudioError('studio_rule_fact_scope_forbidden', 403);
  const input = await read(factsRef);
  if (Buffer.byteLength(input.text) > 256 * 1024) throw new StudioError('studio_rule_fact_limit', 413);
  let raw: any; try { raw = JSON.parse(input.text); } catch { invalid(); }
  if (!object(raw)) invalid();
  keys(raw, ['contractVersion', 'purpose', 'facts', 'targets', 'coverage']);
  if (raw.purpose !== purpose) throw new StudioError('studio_rule_purpose_mismatch_copy_facts_purpose', 400);
  if (raw.contractVersion !== 'studio-rule-facts/1' || !Array.isArray(raw.facts) || raw.facts.length > STUDIO_RULE_BUDGET.maxFacts || !Array.isArray(raw.targets) || raw.targets.length > STUDIO_RULE_BUDGET.maxFacts || !object(raw.coverage)) invalid();
  keys(raw.coverage, ['complete', 'detail', 'cutoffAt', 'businessTime', 'missingRequirementIds']);
  if (typeof raw.coverage.complete !== 'boolean' || !Array.isArray(raw.coverage.missingRequirementIds) || !raw.coverage.missingRequirementIds.every((id: unknown) => typeof id === 'string' && execution.factRequirements.some(r => r.requirementId === id))) invalid();
  const coverage = { complete: raw.coverage.complete, detail: text(raw.coverage.detail, 4000, false), cutoffAt: text(raw.coverage.cutoffAt, 200, false), businessTime: text(raw.coverage.businessTime, 1000, false), missingRequirementIds: raw.coverage.missingRequirementIds as string[] };
  if (!Number.isFinite(Date.parse(coverage.cutoffAt)) || !/(Z|[+-]\d{2}:\d{2})$/.test(coverage.cutoffAt) || coverage.complete && coverage.missingRequirementIds.length) invalid();
  const facts: StudioRuleFact[] = [], seen = new Set<string>();
  for (const value of raw.facts) {
    if (!object(value)) invalid(); keys(value, ['factId', 'statement', 'requirementId', 'sourceRefs', 'locator', 'kind', 'bindingRef']);
    const requirement = execution.factRequirements.find(r => r.requirementId === value.requirementId);
    if (!requirement || value.kind !== requirement.kind || !Array.isArray(value.sourceRefs) || !value.sourceRefs.length || value.sourceRefs.length > 8) invalid();
    const bindingRef = sourceRef(value.bindingRef);
    if (digest(bindingRef) !== digest(requirement.bindingRef)) throw new StudioError('studio_rule_binding_mismatch', 409);
    const binding = await read(bindingRef); if (binding.assetKind !== 'binding' && bindingRef.authority !== 'data') throw new StudioError('studio_rule_binding_mismatch', 409);
    const sourceRefs: StudioSourceRef[] = value.sourceRefs.map(sourceRef);
    if (sourceRefs.some(r => r.authority === 'data' && r.projectId !== options.projectId)) throw new StudioError('studio_rule_fact_scope_forbidden', 403);
    for (const r of sourceRefs) await read(r);
    for (const required of [requirement.sourceRef, ...(requirement.calculationRefs ?? [])]) if (!sourceRefs.some(r => digest(r) === digest(required))) throw new StudioError('studio_rule_fact_evidence_mismatch', 409);
    if (value.kind === 'external-computation' && !requirement.calculationRefs?.length) invalid();
    for (const r of requirement.calculationRefs ?? []) await read(r);
    const factId = text(value.factId, 200, false); if (seen.has(factId)) invalid(); seen.add(factId);
    facts.push({ factId, statement: text(value.statement, 2000, false), requirementId: requirement.requirementId, sourceRefs, locator: text(value.locator, 2000, false), kind: value.kind as StudioRuleFact['kind'], bindingRef });
  }
  const targets: StudioRuleTarget[] = [], targetIds = new Set<string>();
  for (const value of raw.targets) {
    if (!object(value)) invalid(); keys(value, ['targetId', 'positive', 'negative']);
    const targetId = text(value.targetId, 200, false); if (targetIds.has(targetId)) invalid(); targetIds.add(targetId);
    targets.push({ targetId, positive: text(value.positive, 2000, false), ...(value.negative !== undefined ? { negative: text(value.negative, 2000, false) } : {}) });
  }
  command = { type: 'reason', execution, facts, targets, coverage, budget: STUDIO_RULE_BUDGET };
  if (!options.execute) return receipt(empty('failed', 'The approved Semantica worker is unavailable; no alternative engine was invoked.'), false);
  current();
  const result = await options.execute(command, context); current();
  if (!result || result.component?.name !== 'semantica' || result.component.version !== '0.7.0' || result.contractVersion !== 'studio-rule-execution/1' || !['complete', 'incomplete', 'unsupported', 'cancelled', 'failed'].includes(result.completion) || !Array.isArray(result.conclusions) || result.conclusions.length > STUDIO_RULE_BUDGET.maxConclusions || !Array.isArray(result.assessments) || !Array.isArray(result.limitations)) throw new StudioError('studio_rule_invalid_worker_result', 502);
  return receipt(result, result.engineInvoked === true);
}
