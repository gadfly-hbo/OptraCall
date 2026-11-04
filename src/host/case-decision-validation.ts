import { CaseStoreError } from './case-types.ts';
import { sourceRef } from './personal-retention-validation.ts';
import { parsePersonalContextTarget } from './personal-context-validation.ts';
import type { CaseActionObservation, CaseDecisionDraftInput, CaseDecisionGovernanceInput, CaseDecisionImpact, CaseDecisionKind, CaseDecisionOrigin, CaseDecisionPayload, CaseDecisionRef, CaseDecisionReference, CaseDecisionTarget, CaseStrategyChoiceInput, CaseStrategyChoiceValue } from './case-decision-types.ts';

const fail = (code = 'invalid_case_decision'): never => { throw new CaseStoreError(code); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function caseDecisionFields(v: unknown, allowed: string[], required: string[] = []): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).some(k => !allowed.includes(k)) || required.some(k => !(k in v))) fail('invalid_case_decision_fields');
}
export const caseDecisionId = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) ? v : fail('invalid_case_decision_id');
export const caseDecisionRevision = (v: unknown, zero = false): number => Number.isSafeInteger(v) && Number(v) >= (zero ? 0 : 1) ? Number(v) : fail('invalid_case_decision_revision');
export function caseDecisionText(v: unknown, max: number, required = false): string {
  if (typeof v !== 'string' || v.length > max || v.includes('\0') || required && !v.trim()) fail('invalid_case_decision_text');
  return v as string;
}
const nullable = (v: unknown): string | null => v == null ? null : caseDecisionText(v, 20000);
export function parseCaseDecisionRef(value: unknown): CaseDecisionRef {
  caseDecisionFields(value, ['type', 'caseStoreId', 'caseId', 'recordId', 'revision'], ['type', 'caseStoreId', 'caseId', 'recordId', 'revision']);
  if (value.type !== 'case-decision') fail('invalid_case_decision_reference');
  return { type: 'case-decision', caseStoreId: caseDecisionId(value.caseStoreId), caseId: caseDecisionId(value.caseId), recordId: caseDecisionId(value.recordId), revision: caseDecisionRevision(value.revision) };
}
export function parseCaseDecisionTarget(value: unknown): CaseDecisionTarget {
  if (!object(value)) return fail('invalid_case_decision_reference');
  if (value.type === 'case-decision') return parseCaseDecisionRef(value);
  if (value.type === 'source') {
    caseDecisionFields(value, ['type', 'source'], ['type', 'source']);
    try { return { type: 'source', source: sourceRef(value.source) }; } catch { return fail('invalid_case_decision_reference'); }
  }
  if (value.type === 'personal') {
    caseDecisionFields(value, ['type', 'target'], ['type', 'target']);
    try { return { type: 'personal', target: parsePersonalContextTarget(value.target) }; } catch { return fail('invalid_case_decision_reference'); }
  }
  if (value.type === 'rap') {
    caseDecisionFields(value, ['type', 'instanceId', 'version'], ['type', 'instanceId', 'version']);
    if (typeof value.instanceId !== 'string' || !/^req-[a-z0-9][a-z0-9-]{0,60}$/.test(value.instanceId) || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) return fail('invalid_case_decision_reference');
    return { type: 'rap', instanceId: value.instanceId, version: value.version };
  }
  if (value.type === 'feedback') {
    caseDecisionFields(value, ['type', 'sourceProjectId', 'boardTaskId', 'feedbackRevisionId', 'handoffId'], ['type', 'sourceProjectId', 'boardTaskId', 'feedbackRevisionId']);
    return { type: 'feedback', sourceProjectId: caseDecisionId(value.sourceProjectId), boardTaskId: caseDecisionId(value.boardTaskId), feedbackRevisionId: caseDecisionId(value.feedbackRevisionId), ...(value.handoffId === undefined ? {} : { handoffId: caseDecisionId(value.handoffId) }) };
  }
  if (value.type === 'board-task') {
    caseDecisionFields(value, ['type', 'projectId', 'itemId', 'taskId', 'observation'], ['type', 'projectId', 'itemId', 'taskId']);
    let observation: CaseActionObservation | undefined;
    if (value.observation !== undefined) {
      const o = value.observation;
      caseDecisionFields(o, ['updatedAt', 'title', 'owner', 'dueDate', 'status', 'note'], ['updatedAt', 'title', 'owner', 'dueDate', 'status', 'note']);
      if (!['todo', 'doing', 'done'].includes(String(o.status)) || typeof o.updatedAt !== 'string' || !Number.isFinite(Date.parse(o.updatedAt))) fail('invalid_case_action_observation');
      observation = { updatedAt: o.updatedAt as string, title: caseDecisionText(o.title, 12000, true), owner: nullable(o.owner), dueDate: nullable(o.dueDate), status: o.status as CaseActionObservation['status'], note: caseDecisionText(o.note, 2000) };
    }
    return { type: 'board-task', projectId: caseDecisionId(value.projectId), itemId: caseDecisionId(value.itemId), taskId: caseDecisionId(value.taskId), ...(observation ? { observation } : {}) };
  }
  return fail('invalid_case_decision_reference');
}
export function parseCaseDecisionReference(value: unknown): CaseDecisionReference {
  caseDecisionFields(value, ['relation', 'target', 'note'], ['relation', 'target']);
  if (!['supports', 'opposes', 'background', 'limits', 'derived_from', 'depends_on', 'action', 'feedback'].includes(String(value.relation))) fail('invalid_case_decision_relation');
  return { relation: value.relation as CaseDecisionReference['relation'], target: parseCaseDecisionTarget(value.target), note: nullable(value.note) };
}
export const caseDecisionTarget = parseCaseDecisionTarget;
export const caseDecisionReference = parseCaseDecisionReference;
export function parseCaseDecisionGovernance(value: unknown): CaseDecisionGovernanceInput {
  caseDecisionFields(value, ['operationId', 'caseStoreId', 'caseId', 'recordId', 'expectedRevision', 'action', 'reference'], ['operationId', 'caseStoreId', 'caseId', 'recordId', 'expectedRevision', 'action']);
  if (!['archive', 'restore', 'add_reference', 'remove_reference'].includes(String(value.action))) fail('invalid_case_decision_governance');
  const hasReference = value.action === 'add_reference' || value.action === 'remove_reference';
  if (!hasReference && value.reference !== undefined) fail('invalid_case_decision_governance');
  return { operationId: caseDecisionId(value.operationId), caseStoreId: caseDecisionId(value.caseStoreId), caseId: caseDecisionId(value.caseId), recordId: caseDecisionId(value.recordId), expectedRevision: caseDecisionRevision(value.expectedRevision), action: value.action as CaseDecisionGovernanceInput['action'], ...(hasReference ? { reference: parseCaseDecisionReference(value.reference) } : {}) };
}
export function parseCaseStrategyChoice(value: unknown): CaseStrategyChoiceInput & { reason: string | null; allowHistorical: boolean } {
  caseDecisionFields(value, ['operationId', 'caseStoreId', 'caseId', 'strategyRef', 'choice', 'reason', 'expectedPreviousChoiceId', 'allowHistorical'], ['operationId', 'caseStoreId', 'caseId', 'strategyRef', 'choice', 'expectedPreviousChoiceId']);
  if (!['trial', 'gather_evidence', 'defer', 'reject', 'no_action', 'continue', 'adjust', 'stop_considering'].includes(String(value.choice)) || value.allowHistorical !== undefined && typeof value.allowHistorical !== 'boolean') fail('invalid_case_strategy_choice');
  return { operationId: caseDecisionId(value.operationId), caseStoreId: caseDecisionId(value.caseStoreId), caseId: caseDecisionId(value.caseId), strategyRef: parseCaseDecisionRef(value.strategyRef), choice: value.choice as CaseStrategyChoiceValue, reason: value.reason == null ? null : caseDecisionText(value.reason, 4000), expectedPreviousChoiceId: value.expectedPreviousChoiceId === null ? null : caseDecisionId(value.expectedPreviousChoiceId), allowHistorical: value.allowHistorical === true };
}
export function parseCaseDecisionPayload(kind: CaseDecisionKind, value: unknown): CaseDecisionPayload {
  const title = object(value) ? caseDecisionText(value.title, 240, true) : fail();
  if ([...title].length > 120) fail('invalid_case_decision_title');
  let result: CaseDecisionPayload;
  if (kind === 'hypothesis') {
    caseDecisionFields(value, ['title', 'statement', 'scope', 'mechanism', 'unknowns', 'whatWouldChangeJudgement', 'assessment', 'assessmentReason'], ['title', 'statement']);
    const assessment = value.assessment ?? 'unresolved';
    if (!['unresolved', 'supported', 'weakened', 'refuted'].includes(String(assessment))) fail('invalid_case_hypothesis_assessment');
    result = { title, statement: caseDecisionText(value.statement, 12000, true), scope: nullable(value.scope), mechanism: nullable(value.mechanism), unknowns: nullable(value.unknowns), whatWouldChangeJudgement: nullable(value.whatWouldChangeJudgement), assessment: assessment as 'unresolved' | 'supported' | 'weakened' | 'refuted', assessmentReason: nullable(value.assessmentReason) };
  } else {
    caseDecisionFields(value, ['title', 'proposal', 'goal', 'mechanism', 'conditions', 'limitations', 'plan'], ['title', 'proposal']);
    let plan = null;
    if (value.plan != null) {
      const v = value.plan;
      caseDecisionFields(v, ['scopeAndAuthority', 'implementationOrEvidenceTiming', 'reviewAndTriggers', 'expectedObservationsAndComparison', 'risksAndExit']);
      plan = { scopeAndAuthority: nullable(v.scopeAndAuthority), implementationOrEvidenceTiming: nullable(v.implementationOrEvidenceTiming), reviewAndTriggers: nullable(v.reviewAndTriggers), expectedObservationsAndComparison: nullable(v.expectedObservationsAndComparison), risksAndExit: nullable(v.risksAndExit) };
    }
    result = { title, proposal: caseDecisionText(value.proposal, 12000, true), goal: nullable(value.goal), mechanism: nullable(value.mechanism), conditions: nullable(value.conditions), limitations: nullable(value.limitations), plan };
  }
  if (JSON.stringify(result).length > 20000) fail('case_decision_payload_too_large');
  return result;
}
export function parseCaseDecisionOrigin(value: unknown): CaseDecisionOrigin {
  caseDecisionFields(value, ['actorKind', 'projectId', 'taskId', 'requestId', 'sessionId', 'toolCallId'], ['actorKind']);
  if (value.actorKind !== 'agent' && value.actorKind !== 'user') fail('invalid_case_decision_actor');
  const result: CaseDecisionOrigin = { actorKind: value.actorKind as 'agent' | 'user', projectId: value.projectId == null ? null : caseDecisionId(value.projectId), taskId: value.taskId == null ? null : caseDecisionId(value.taskId), requestId: nullable(value.requestId), sessionId: nullable(value.sessionId), toolCallId: nullable(value.toolCallId) };
  if (result.actorKind === 'agent' && [result.projectId, result.taskId, result.requestId, result.sessionId, result.toolCallId].some(v => !v)) fail('invalid_case_decision_actor');
  return result;
}
export function parseCaseDecisionDraft(value: unknown, hostLineage?: CaseDecisionRef, envelope: 'request' | 'record' = 'request'): CaseDecisionDraftInput & { references: CaseDecisionReference[]; impactNotes: CaseDecisionImpact[]; changeReason: string | null } {
  caseDecisionFields(value, ['operationId', 'caseStoreId', 'caseId', 'recordId', 'expectedRevision', 'kind', 'payload', 'references', 'impactNotes', 'changeReason'], ['operationId', 'caseStoreId', 'caseId', 'expectedRevision', 'kind', 'payload']);
  if (value.kind !== 'hypothesis' && value.kind !== 'strategy') fail('invalid_case_decision_kind');
  const refs = value.references ?? [], impacts = value.impactNotes ?? [];
  // A saved row is not another request: defaults, Host lineage and several legal
  // human associations can outgrow one transport envelope. Its existing finite
  // field/count caps still apply; Agent input and actual tool output stay bounded.
  if (!Array.isArray(refs) || refs.length > (hostLineage ? 33 : 32) || !Array.isArray(impacts) || impacts.length > 32 || envelope === 'request' && Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) fail('case_decision_input_too_large');
  const references = (refs as unknown[]).map(parseCaseDecisionReference);
  // Only a trusted governance/read path supplies this exact immediate parent.
  // Models still have a 32-reference input bound; one Host-generated lineage
  // item must not make a legal full card impossible to archive or restore.
  if (references.length > 32 && (!hostLineage || !references.some(ref => ref.relation === 'derived_from' && ref.note === null && ref.target.type === 'case-decision' && ref.target.caseStoreId === hostLineage.caseStoreId && ref.target.caseId === hostLineage.caseId && ref.target.recordId === hostLineage.recordId && ref.target.revision === hostLineage.revision))) fail('case_decision_input_too_large');
  const keys = references.map(r => JSON.stringify([r.relation, r.target]));
  if (new Set(keys).size !== keys.length) fail('duplicate_case_decision_reference');
  const impactNotes = (impacts as unknown[]).map(v => { caseDecisionFields(v, ['target', 'explanation'], ['target', 'explanation']); return { target: parseCaseDecisionRef(v.target), explanation: caseDecisionText(v.explanation, 20000, true) }; });
  return { operationId: caseDecisionId(value.operationId), caseStoreId: caseDecisionId(value.caseStoreId), caseId: caseDecisionId(value.caseId), ...(value.recordId === undefined ? {} : { recordId: caseDecisionId(value.recordId) }), expectedRevision: caseDecisionRevision(value.expectedRevision, true), kind: value.kind as CaseDecisionKind, payload: parseCaseDecisionPayload(value.kind as CaseDecisionKind, value.payload), references, impactNotes, changeReason: nullable(value.changeReason) };
}
