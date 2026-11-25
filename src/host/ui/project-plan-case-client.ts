import type { CaseGoalBindingInput } from '../case-types.ts';
import type { ProjectPlanCapabilities, ProjectPlanContent } from '../project-plan-types.ts';
import * as cases from './case-client.ts';
import * as plans from './project-plan-client.ts';
import { canonicalDataContextValue } from '../project-data-context-request.ts';

export interface ProjectPlanCaseConnection {
  projectId: string;
  create?: { operationId: string; title: string; description: string; goalBinding: CaseGoalBindingInput };
  goalBinding: CaseGoalBindingInput;
  goalContext?: ProjectPlanContent['goalContext'];
  caseId?: string;
  caseRevision?: number;
  linkOperationId: string;
  createAttempted?: boolean;
  linkAttempted?: boolean;
  linkedRevision?: number;
  failure?: string;
}
export type ProjectPlanCaseContext = ProjectPlanCapabilities['caseContexts'][number];
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const pendingKey = (projectId: string) => `optracall.project-plan-case.v1:${projectId}`;
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
function pendingUnavailable(): never { throw new ProjectPlanCaseConnectionError('project_plan_case_pending_unavailable'); }
function checkedPending(value: ProjectPlanCaseConnection, projectId: string): ProjectPlanCaseConnection {
  const ref = (value: unknown): boolean => Boolean(value && typeof value === 'object' && uuid((value as { goalId?: unknown }).goalId) && Number.isSafeInteger((value as { version?: unknown }).version) && Number((value as { version?: unknown }).version) > 0);
  if (!value || typeof value !== 'object' || value.projectId !== projectId || !uuid(projectId) || !uuid(value.linkOperationId) || !value.goalBinding || !ref(value.goalBinding.primary) || !Array.isArray(value.goalBinding.related) || value.goalBinding.related.length > 20 || !value.goalBinding.related.every(ref)) return pendingUnavailable();
  if (value.caseId !== undefined && (!uuid(value.caseId) || !Number.isSafeInteger(value.caseRevision) || Number(value.caseRevision) < 1) || !value.create && !value.caseId) return pendingUnavailable();
  if (value.create && (!uuid(value.create.operationId) || typeof value.create.title !== 'string' || !value.create.title.trim() || [...value.create.title].length > 80 || typeof value.create.description !== 'string' || [...value.create.description].length > 20000 || canonicalDataContextValue(value.create.goalBinding) !== canonicalDataContextValue(value.goalBinding))) return pendingUnavailable();
  if (value.goalContext !== undefined && (!ref(value.goalContext.goal) || !['query', 'asset-construction', 'assigned-work', 'case-investigation'].includes(value.goalContext.purpose) || ![value.goalBinding.primary, ...value.goalBinding.related].some(goal => canonicalDataContextValue(goal) === canonicalDataContextValue(value.goalContext!.goal)))) return pendingUnavailable();
  if ([value.createAttempted, value.linkAttempted].some(field => field !== undefined && typeof field !== 'boolean') || value.linkAttempted && !value.caseId || value.linkedRevision !== undefined && (!value.linkAttempted || !Number.isSafeInteger(value.linkedRevision) || value.linkedRevision < 1) || value.failure !== undefined && typeof value.failure !== 'string') return pendingUnavailable();
  return structuredClone(value);
}
export function readPendingProjectCase(storage: PendingStorage, projectId: string): ProjectPlanCaseConnection | null {
  try {
    const bytes = storage.getItem(pendingKey(projectId)); if (bytes === null) return null;
    if (bytes.length > 100000) return pendingUnavailable();
    const value = JSON.parse(bytes); if (value.schemaVersion !== 1) return pendingUnavailable();
    return checkedPending(value.intent, projectId);
  } catch { return pendingUnavailable(); }
}
export function savePendingProjectCase(storage: PendingStorage, intent: ProjectPlanCaseConnection): void {
  try {
    checkedPending(intent, intent.projectId);
    const previous = readPendingProjectCase(storage, intent.projectId);
    if (previous && (previous.linkOperationId !== intent.linkOperationId || canonicalDataContextValue(previous.goalBinding) !== canonicalDataContextValue(intent.goalBinding) || canonicalDataContextValue(previous.goalContext ?? null) !== canonicalDataContextValue(intent.goalContext ?? null) || canonicalDataContextValue(previous.create ?? null) !== canonicalDataContextValue(intent.create ?? null) || previous.caseId !== undefined && (previous.caseId !== intent.caseId || previous.caseRevision !== intent.caseRevision))) return pendingUnavailable();
    const bytes = JSON.stringify({ schemaVersion: 1, intent }); if (bytes.length > 100000) return pendingUnavailable();
    storage.setItem(pendingKey(intent.projectId), bytes);
    if (storage.getItem(pendingKey(intent.projectId)) !== bytes) return pendingUnavailable();
  } catch { return pendingUnavailable(); }
}
export function clearPendingProjectCase(storage: PendingStorage, projectId: string): void { readPendingProjectCase(storage, projectId); storage.removeItem(pendingKey(projectId)); }
export class ProjectPlanCaseConnectionError extends Error {
  readonly code: string;
  constructor(code = 'project_plan_case_result_unknown') {
    const messages: Record<string, string> = { project_plan_case_context_changed: 'Case 或目标已有变化，请保留原记录，重新明确采用的准确版本。', project_plan_case_pending_unavailable: '原Case关联尝试暂存不可核对，未覆盖或另建。请保留浏览器记录，核对原操作后再继续。', project_plan_case_operation_conflict: '原Case操作身份或内容不一致，未采用其他回执；请保留原输入和编号，核对原Case记录。' };
    super(messages[code] || 'Case 操作结果尚未核实，原输入和操作编号保留；请先核对原操作，不另建。'); this.code = code;
  }
}
function fail(code?: string): never { throw new ProjectPlanCaseConnectionError(code); }
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalDataContextValue(value))))].map(x => x.toString(16).padStart(2, '0')).join('');
async function receipt(operationId: string, kind: string, request: Record<string, unknown>) {
    const { operation } = await cases.operation(operationId);
    if (!operation || operation.phase !== 'completed' || !operation.result) return fail();
    if (operation.operationId !== operationId || operation.kind !== kind || operation.requestSha256 !== await hash({ kind, ...request })) return fail('project_plan_case_operation_conflict');
    return operation;
  }
export async function inspectCreatedCase(input: {operationId:string;title:string;description:string;goalBinding:CaseGoalBindingInput;goalIntent?:import('../case-types.ts').CaseGoalIntentRef;creationSource?:import('../case-types.ts').CaseCreationSource}) {
  const saved = await receipt(input.operationId, 'case_create', { ...input, title: input.title.trim(), judgement:'', nextStep:'', status:'pending' });
  const record = saved.result!;
  if (typeof record.id !== 'string' || !Number.isSafeInteger(record.revision) || saved.caseId !== record.id) return fail();
  return {id:record.id,revision:Number(record.revision)};
}
/** Advance one explicit UI intent through the original Case operations. Inspection never writes or retries a POST. */
export async function connectProjectPlanCase(intent: ProjectPlanCaseConnection, options: { readOnly?: boolean; changed?(intent: ProjectPlanCaseConnection): void } = {}): Promise<ProjectPlanCaseContext | null> {
  const changed = () => options.changed?.(structuredClone(intent));
  if (!intent.caseId) {
    const input = intent.create; if (!input) return fail();
    if (!intent.createAttempted) {
      if (options.readOnly) return null;
      intent.createAttempted = true; delete intent.failure; changed();
      try { await cases.create(input); }
      catch (error) { if (error instanceof cases.CaseRequestError && error.status < 500 && error.code !== 'operation_conflict') { intent.createAttempted = false; intent.failure = error.code; changed(); throw error; } return fail(); }
    }
    const record = await inspectCreatedCase(input);
    intent.caseId = record.id; intent.caseRevision = record.revision; changed();
  }
  if (intent.linkedRevision === undefined) {
    if (!intent.caseRevision) return fail();
    const input = { operationId: intent.linkOperationId, expectedRevision: intent.caseRevision, projectId: intent.projectId };
    if (!intent.linkAttempted) {
      if (options.readOnly) return null;
      intent.linkAttempted = true; delete intent.failure; changed();
      try { await cases.linkProject(intent.caseId, input); }
      catch (error) { if (error instanceof cases.CaseRequestError && error.status < 500 && error.code !== 'operation_conflict') { intent.failure = error.code; changed(); } return fail(); }
    }
    const saved = await receipt(intent.linkOperationId, 'project_link', { ...input, caseId: intent.caseId });
    const record = saved.result!.case as { id?: unknown; revision?: unknown } | undefined;
    if (saved.caseId !== intent.caseId || saved.projectId !== intent.projectId || record?.id !== intent.caseId || !Number.isSafeInteger(record.revision)) return fail();
    intent.linkedRevision = Number(record.revision); changed();
  }
  const catalog = await plans.capabilities(intent.projectId), context = catalog.caseContexts.find(value => value.caseId === intent.caseId);
  if (!context || context.caseRevision !== intent.linkedRevision || canonicalDataContextValue({ primary: context.primaryGoal, related: context.relatedGoals || [] }) !== canonicalDataContextValue({ primary: intent.goalBinding.primary, related: intent.goalBinding.related })) return fail('project_plan_case_context_changed');
  return structuredClone(context);
}
