import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalDataContextValue } from './project-data-context-request.ts';
import { safePath, readBytes, atomicJson, directory, isMissing } from './project-data-context-io.ts';
import { parseUsageContext, parseUsageContextOrigin, type UsageContext, type UsageContextOrigin } from './usage-context-types.ts';
import { parseGoalBasis, type GoalBasis } from './strategy-goals-types.ts';
import type { ProjectPlanState, ProjectPlanDraftInput, ProjectPlanPreparedDraftInput, ProjectPlanMeceReview, ProjectPlanDraftResult, ProjectPlanConfirmInput, ProjectPlanConfirmResult, ProjectPlanEffects, ProjectPlanTaskResultInput, ProjectPlanContent, ProjectPlanVersion, ProjectPlanConfirmation, ProjectPlanTaskReceipt } from './project-plan-types.ts';
export class ProjectPlanFault extends Error {
  code: string; status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
function fail(code: string, status = 409): never { throw new ProjectPlanFault(code, status); }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const known = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const text = (value: unknown, max = 20000): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0');
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const canonical = (value: unknown): string => canonicalDataContextValue(value, () => fail('invalid_project_plan', 400));
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const isGoal = (value: unknown): boolean => object(value) && known(value, ['goalId', 'version']) && uuid(value.goalId) && integer(value.version) && value.version > 0;
export function parseProjectPlanContent(value: unknown): ProjectPlanContent {
  if (!object(value) || !known(value, ['request', 'usageContext', 'usageContextOrigin', 'goalBasis', 'premises', 'materials', 'coverage', 'tasks', 'taskMode', 'summaryTaskKey', 'dependencies', 'caseContext', 'goalContext', 'requirementRef']) || !text(value.request) || !value.request.trim() || !Array.isArray(value.premises) || value.premises.some(item => !text(item)) || !Array.isArray(value.materials) || !Array.isArray(value.coverage) || !Array.isArray(value.tasks) || !Array.isArray(value.dependencies) || !['single', 'multi'].includes(value.taskMode as string) || !key(value.summaryTaskKey)) return fail('invalid_project_plan', 400);
  if (value.usageContext !== undefined) { try { parseUsageContext(value.usageContext); } catch { return fail('invalid_project_plan_usage_context', 400); } }
  if (value.usageContextOrigin !== undefined) { try { if (value.usageContext === undefined) throw new Error(); parseUsageContextOrigin(value.usageContextOrigin); } catch { return fail('invalid_project_plan_usage_context', 400); } }
  if (value.goalBasis !== undefined) { try { parseGoalBasis(value.goalBasis); } catch { return fail('invalid_project_plan_goal_basis', 400); } }
  const validRef = (ref: unknown, capability = false): boolean => object(ref) && known(ref, ['kind', 'id', 'version', 'sha256', 'permissionRef']) && (capability ? ['skill', 'sap-method', 'connector'] : ['project-file', 'enterprise-material', 'connector', 'provided']).includes(ref.kind as string) && text(ref.id, 2000) && !!ref.id.trim() && (ref.version === undefined || text(ref.version, 2000) && !!ref.version.trim()) && (ref.sha256 === undefined || typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256)) && (ref.permissionRef === undefined || text(ref.permissionRef, 2000)) && (ref.kind !== 'sap-method' || !!ref.version);
  if (!value.materials.every(ref => validRef(ref))) return fail('invalid_project_plan', 400);
  const taskKeys = new Set<string>(), taskIds = new Set<string>();
  for (const task of value.tasks) {
    if (!object(task) || !known(task, ['key', 'name', 'selected', 'taskId', 'scope', 'capabilities']) || !key(task.key) || taskKeys.has(task.key) || !text(task.name, 80) || !task.name.trim() || /[\u0000-\u001f\u007f]/.test(task.name) || typeof task.selected !== 'boolean' || !text(task.scope) || !Array.isArray(task.capabilities) || !task.capabilities.every(ref => validRef(ref, true)) || task.taskId !== undefined && (!uuid(task.taskId) || taskIds.has(task.taskId))) return fail('invalid_project_plan', 400);
    taskKeys.add(task.key); if (task.taskId) taskIds.add(task.taskId as string);
  }
  const selected = value.tasks.filter(task => task.selected), summary = value.tasks.find(task => task.key === value.summaryTaskKey);
  if (!selected.length || !summary || !summary.taskId && !summary.selected || value.taskMode === 'single' && (selected.length !== 1 || selected[0].key !== summary.key)) return fail('invalid_project_plan_summary', 400);
  const coverageKeys = new Set<string>();
  for (const item of value.coverage) {
    if (!object(item) || !known(item, ['key', 'parentKey', 'label', 'disposition', 'reason', 'taskKeys']) || !key(item.key) || coverageKeys.has(item.key) || item.parentKey !== undefined && (!key(item.parentKey) || item.parentKey === item.key) || !text(item.label, 2000) || !item.label.trim() || !['focus', 'covered', 'deferred', 'unknown', 'out-of-scope'].includes(item.disposition as string) || !text(item.reason) || !Array.isArray(item.taskKeys) || item.taskKeys.some(taskKey => typeof taskKey !== 'string' || !taskKeys.has(taskKey)) || new Set(item.taskKeys).size !== item.taskKeys.length) return fail('invalid_project_plan', 400);
    coverageKeys.add(item.key);
  }
  if (value.coverage.some(item => item.parentKey && !coverageKeys.has(item.parentKey))) return fail('invalid_project_plan', 400);
  for (const dependency of value.dependencies) if (!object(dependency) || !known(dependency, ['from', 'to', 'reason']) || typeof dependency.from !== 'string' || !taskKeys.has(dependency.from) || typeof dependency.to !== 'string' || !taskKeys.has(dependency.to) || dependency.from === dependency.to || !text(dependency.reason)) return fail('invalid_project_plan', 400);
  if (value.caseContext !== null) {
    const context = value.caseContext;
    if (!object(context) || !known(context, ['caseId', 'primaryGoal', 'relatedGoals', 'caseRevision', 'projectWorkRevision']) || !uuid(context.caseId) || context.caseRevision !== undefined && (!integer(context.caseRevision) || context.caseRevision < 1) || context.projectWorkRevision !== undefined && !integer(context.projectWorkRevision) || !isGoal(context.primaryGoal) || context.relatedGoals !== undefined && (!Array.isArray(context.relatedGoals) || !context.relatedGoals.every(isGoal))) return fail('invalid_project_plan_context', 400);
  }
  if (value.goalContext !== undefined) {
    const context = value.goalContext;
    if (!object(context) || !known(context, ['goal', 'purpose']) || !isGoal(context.goal) || typeof context.purpose !== 'string' || !['query', 'asset-construction', 'assigned-work', 'case-investigation'].includes(context.purpose) || context.purpose === 'case-investigation' && value.caseContext === null) return fail('invalid_project_plan_goal_context', 400);
  }
  if (value.requirementRef !== undefined && (!object(value.requirementRef) || !known(value.requirementRef, ['instanceId', 'version']) || !text(value.requirementRef.instanceId, 2000) || !value.requirementRef.instanceId || !integer(value.requirementRef.version) || value.requirementRef.version < 1)) return fail('invalid_project_plan', 400);
  return structuredClone(value) as unknown as ProjectPlanContent;
}
const content = parseProjectPlanContent;

function stableId(projectId: string, confirmationId: string, taskKey: string, purpose: string): string {
  const hex = createHash('sha256').update(canonical([projectId, confirmationId, taskKey, purpose])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const participants = (plan: ProjectPlanContent) => plan.tasks.filter(task => task.selected || task.key === plan.summaryTaskKey);
const safeCode = (value: unknown): string | undefined => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(value) ? value : undefined;
function confirmationValid(value: unknown, projectId: string, drafts: ProjectPlanVersion[]): value is ProjectPlanConfirmation {
  if (!object(value) || !known(value, ['id', 'projectId', 'planVersion', 'confirmedAt', 'mode', 'authorizations', 'plan', 'tasks']) || !uuid(value.id) || value.projectId !== projectId || !integer(value.planVersion) || value.planVersion < 1 || !drafts[value.planVersion - 1] || !date(value.confirmedAt) || !['create', 'start'].includes(value.mode as string) || !Array.isArray(value.tasks) || !Array.isArray(value.authorizations) || !value.authorizations.length || value.authorizations[0]?.operationId !== value.id || value.authorizations.at(-1)?.mode !== value.mode || value.authorizations.some(authorization => !object(authorization) || !known(authorization, ['operationId', 'mode', 'authorizedAt']) || !uuid(authorization.operationId) || !['create', 'start'].includes(authorization.mode as string) || !date(authorization.authorizedAt))) return false;
  const plan = content(value.plan); if (digest(plan) !== digest(drafts[value.planVersion - 1].plan)) return false;
  const expected = participants(plan); if (value.tasks.length !== expected.length) return false;
  return value.tasks.every((receipt, index) => {
    const task = expected[index];
    if (!object(receipt) || !known(receipt, ['taskKey', 'taskId', 'createRequestId', 'startRequestId', 'createStatus', 'startStatus', 'createCode', 'startCode', 'observations']) || receipt.taskKey !== task.key || receipt.taskId !== (task.taskId || stableId(projectId, value.id as string, task.key, 'task')) || receipt.createRequestId !== stableId(projectId, value.id as string, task.key, 'create') || receipt.startRequestId !== stableId(projectId, value.id as string, task.key, 'start') || !['pending', 'not-required', 'created', 'failed', 'unknown', 'cancelled'].includes(receipt.createStatus as string) || !['pending', 'not-requested', 'accepted', 'failed', 'unknown', 'cancelled'].includes(receipt.startStatus as string) || receipt.createCode !== undefined && !safeCode(receipt.createCode) || receipt.startCode !== undefined && !safeCode(receipt.startCode) || !Array.isArray(receipt.observations)) return false;
    if (task.taskId && receipt.createStatus !== 'not-required' || !task.taskId && receipt.createStatus === 'not-required' || value.mode === 'create' && receipt.startStatus !== 'not-requested' || !['created', 'not-required'].includes(receipt.createStatus as string) && receipt.startStatus === 'accepted') return false;
    return receipt.observations.every(observation => object(observation) && known(observation, ['phase', 'status', 'code', 'recordedAt']) && ['create', 'start'].includes(observation.phase as string) && ['created', 'accepted', 'failed', 'unknown', 'cancelled'].includes(observation.status as string) && (observation.code === undefined || !!safeCode(observation.code)) && date(observation.recordedAt));
  });
}

const validMece = (value: unknown): value is ProjectPlanMeceReview => object(value) && known(value, ['sameLevel', 'coverage', 'boundaries', 'depth']) && ['sameLevel', 'coverage', 'boundaries', 'depth'].every(key => text(value[key]) && !!(value[key] as string).trim());
interface Operation { id: string; kind: 'draft' | 'confirm' | 'prepare'; fingerprint: string; version: number; confirmationId?: string; mece?: ProjectPlanMeceReview; limitations?: string[] }
interface RecordData { formatVersion: 1; projectId: string; revision: number; drafts: ProjectPlanVersion[]; confirmations: ProjectPlanConfirmation[]; operations: Operation[] }
const initial = (projectId: string): RecordData => ({ formatVersion: 1, projectId, revision: 0, drafts: [], confirmations: [], operations: [] });
const view = (record: RecordData): ProjectPlanState => ({ formatVersion: 1, projectId: record.projectId, revision: record.revision, ...(record.drafts.length ? { draft: structuredClone(record.drafts.at(-1)!) } : {}), ...(record.confirmations.length ? { confirmed: structuredClone(record.confirmations.at(-1)!) } : {}), history: structuredClone(record.confirmations), ...(record.operations.length ? { operations: record.operations.map(operation => ({ operationId: operation.id, kind: operation.kind, planVersion: operation.version, requestHash: operation.fingerprint, ...(operation.confirmationId ? { confirmationId: operation.confirmationId } : {}) })) } : {}), ...(record.operations.some(operation => operation.kind === 'prepare') ? { preparations: record.operations.filter(operation => operation.kind === 'prepare').map(operation => ({ operationId: operation.id, status: 'completed' as const, inputHash: operation.fingerprint, draftVersion: operation.version, mece: structuredClone(operation.mece!), limitations: [...operation.limitations!] })) } : {}) });

/** Business plan/receipt persistence only; all Agent resources stay with their original owner. */
export function createProjectPlanStore(options: { dataRoot: string }) {
  const root = path.resolve(options.dataRoot); let mutation: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => { const next = mutation.then(run, run); mutation = next.catch(() => {}); return next; };
  async function record(projectId: string): Promise<RecordData> {
    if (!uuid(projectId)) return fail('invalid_project_plan_identity', 400);
    try {
      const file = await safePath(root, `project-plans/${projectId}.json`), bytes = await readBytes(file, 2 * 1024 * 1024);
      let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('project_plan_corrupt'); }
      if (!object(value) || !known(value, ['formatVersion', 'projectId', 'revision', 'drafts', 'confirmations', 'operations']) || value.formatVersion !== 1 || value.projectId !== projectId || !integer(value.revision) || !Array.isArray(value.drafts) || !Array.isArray(value.confirmations) || !Array.isArray(value.operations)) return fail('project_plan_corrupt');
      try {
        value.drafts.forEach((draft, index) => { if (!object(draft) || !known(draft, ['version', 'createdAt', 'plan']) || draft.version !== index + 1 || !date(draft.createdAt)) fail('project_plan_corrupt'); content(draft.plan); });
        if (!value.confirmations.every(confirmation => confirmationValid(confirmation, projectId, value.drafts as ProjectPlanVersion[])) || new Set(value.confirmations.map(confirmation => confirmation.id)).size !== value.confirmations.length) fail('project_plan_corrupt');
        const ids = new Set<string>(); value.operations.forEach(operation => { if (!object(operation) || !known(operation, ['id', 'kind', 'fingerprint', 'version', 'confirmationId', 'mece', 'limitations']) || !uuid(operation.id) || ids.has(operation.id) || !['draft', 'confirm', 'prepare'].includes(operation.kind as string) || typeof operation.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(operation.fingerprint) || !integer(operation.version) || operation.version < 1 || operation.version > (value.drafts as unknown[]).length) fail('project_plan_corrupt'); if (operation.kind === 'confirm' && (!uuid(operation.confirmationId) || !(value.confirmations as ProjectPlanConfirmation[]).some(confirmation => confirmation.id === operation.confirmationId && confirmation.planVersion === operation.version)) || operation.kind !== 'confirm' && operation.confirmationId !== undefined || operation.kind === 'prepare' && (!validMece(operation.mece) || !Array.isArray(operation.limitations) || !operation.limitations.every(item => text(item) && !!item.trim())) || operation.kind !== 'prepare' && (operation.mece !== undefined || operation.limitations !== undefined)) fail('project_plan_corrupt'); ids.add(operation.id); });
      } catch { return fail('project_plan_corrupt'); }
      return value as unknown as RecordData;
    } catch (error) { if (isMissing(error)) return initial(projectId); throw error; }
  }
  async function write(value: RecordData): Promise<void> {
    await directory(root, true); const file = await safePath(root, `project-plans/${value.projectId}.json`, true); await atomicJson(file, value);
  }
  async function read(projectId: string): Promise<ProjectPlanState> { return serial(async () => view(await record(projectId))); }
  async function saveDraft(projectId: string, input: ProjectPlanDraftInput, resolved?: { usageContext?: UsageContext; usageContextOrigin?: UsageContextOrigin; goalBasis?: GoalBasis }): Promise<ProjectPlanDraftResult> {
    if (!object(input) || !known(input, ['operationId', 'expectedRevision', 'plan']) || !uuid(input.operationId) || !integer(input.expectedRevision)) return fail('invalid_project_plan_mutation', 400);
    return save(projectId, input, 'draft', digest(input), undefined, resolved);
  }
  async function savePreparedDraft(projectId: string, input: ProjectPlanPreparedDraftInput): Promise<ProjectPlanDraftResult> {
    if (!object(input) || !known(input, ['operationId', 'expectedRevision', 'plan', 'requestHash', 'mece', 'limitations']) || !uuid(input.operationId) || !integer(input.expectedRevision) || typeof input.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.requestHash) || !validMece(input.mece) || !Array.isArray(input.limitations) || !input.limitations.every(item => text(item) && !!item.trim())) return fail('invalid_project_plan_mutation', 400);
    return save(projectId, input, 'prepare', input.requestHash, { mece: input.mece, limitations: input.limitations });
  }
  async function save(projectId: string, input: ProjectPlanDraftInput, kind: 'draft' | 'prepare', fingerprint: string, metadata?: { mece: ProjectPlanMeceReview; limitations: string[] }, resolved?: { usageContext?: UsageContext; usageContextOrigin?: UsageContextOrigin; goalBasis?: GoalBasis }): Promise<ProjectPlanDraftResult> {
    const plan = content(input.plan);
    return serial(async () => {
      const previous = await record(projectId), repeated = previous.operations.find(operation => operation.id === input.operationId);
      if (repeated) { if (repeated.kind !== kind || repeated.fingerprint !== fingerprint) return fail('project_plan_operation_conflict'); return { state: view(previous), draft: structuredClone(previous.drafts[repeated.version - 1]!), replayed: true }; }
      if (previous.revision !== input.expectedRevision) return fail('project_plan_conflict');
      const fixedPlan = structuredClone(plan);
      if (resolved) {
        delete fixedPlan.usageContext; delete fixedPlan.usageContextOrigin;
        if (resolved.usageContext !== undefined) fixedPlan.usageContext = parseUsageContext(resolved.usageContext);
        if (resolved.usageContextOrigin !== undefined) fixedPlan.usageContextOrigin = parseUsageContextOrigin(resolved.usageContextOrigin);
      }
      if (fixedPlan.goalBasis === undefined && resolved?.goalBasis !== undefined) fixedPlan.goalBasis = parseGoalBasis(resolved.goalBasis);
      for (const task of fixedPlan.tasks) if (!task.taskId) { const binding = previous.confirmations.flatMap(confirmation => confirmation.tasks).reverse().find(receipt => receipt.taskKey === task.key && ['created', 'not-required', 'pending', 'unknown'].includes(receipt.createStatus)); if (binding) task.taskId = binding.taskId; }
      const draft: ProjectPlanVersion = { version: previous.drafts.length + 1, createdAt: new Date().toISOString(), plan: fixedPlan };
      const next = { ...previous, revision: previous.revision + 1, drafts: [...previous.drafts, draft], operations: [...previous.operations, { id: input.operationId, kind, fingerprint, version: draft.version, ...(metadata ? structuredClone(metadata) : {}) }] };
      await write(next); return { state: view(next), draft: structuredClone(draft), replayed: false };
    });
  }
  async function recordTaskResult(projectId: string, input: ProjectPlanTaskResultInput): Promise<ProjectPlanState> {
    if (!object(input) || !known(input, ['confirmationId', 'taskKey', 'taskId', 'phase', 'requestId', 'status', 'code']) || !uuid(input.confirmationId) || !key(input.taskKey) || !uuid(input.taskId) || !uuid(input.requestId) || !['create', 'start'].includes(input.phase) || !['created', 'accepted', 'failed', 'unknown', 'cancelled'].includes(input.status) || input.code !== undefined && !safeCode(input.code) || input.phase === 'create' && input.status === 'accepted' || input.phase === 'start' && input.status === 'created') return fail('invalid_project_plan_result', 400);
    return serial(async () => {
      const previous = await record(projectId), confirmation = previous.confirmations.find(item => item.id === input.confirmationId), receipt = confirmation?.tasks.find(item => item.taskKey === input.taskKey);
      if (!confirmation || !receipt || receipt.taskId !== input.taskId || (input.phase === 'create' ? receipt.createRequestId : receipt.startRequestId) !== input.requestId) return fail('project_plan_result_conflict');
      const statusField = input.phase === 'create' ? 'createStatus' : 'startStatus', codeField = input.phase === 'create' ? 'createCode' : 'startCode';
      if (receipt[statusField] === input.status && receipt[codeField] === input.code) return view(previous);
      if (!['pending', 'unknown'].includes(receipt[statusField]) || input.phase === 'start' && (confirmation.mode !== 'start' || !['created', 'not-required'].includes(receipt.createStatus))) return fail('project_plan_result_conflict');
      const changed: ProjectPlanTaskReceipt = { ...receipt, [statusField]: input.status, observations: [...receipt.observations, { phase: input.phase, status: input.status, ...(input.code ? { code: input.code } : {}), recordedAt: new Date().toISOString() }] };
      delete changed[codeField]; if (input.code) changed[codeField] = input.code;
      if (input.phase === 'create' && ['failed', 'cancelled'].includes(input.status)) changed.startStatus = 'not-requested';
      const next = { ...previous, revision: previous.revision + 1, confirmations: previous.confirmations.map(item => item.id === confirmation.id ? { ...item, tasks: item.tasks.map(item => item.taskKey === receipt.taskKey ? changed : item) } : item) };
      await write(next); return view(next);
    });
  }
  async function confirm(projectId: string, input: ProjectPlanConfirmInput, effects: ProjectPlanEffects): Promise<ProjectPlanConfirmResult> {
    if (!object(input) || !known(input, ['operationId', 'expectedRevision', 'mode']) || !uuid(input.operationId) || !integer(input.expectedRevision) || !['create', 'start'].includes(input.mode)) return fail('invalid_project_plan_mutation', 400);
    const fingerprint = digest(input);
    const prepared = await serial(async () => {
      const previous = await record(projectId), repeated = previous.operations.find(operation => operation.id === input.operationId);
      if (repeated) { if (repeated.kind !== 'confirm' || repeated.fingerprint !== fingerprint) return fail('project_plan_operation_conflict'); const confirmation = previous.confirmations.find(item => item.id === repeated.confirmationId)!; return { state: view(previous), confirmation: structuredClone(confirmation), replayed: true }; }
      if (previous.revision !== input.expectedRevision) return fail('project_plan_conflict');
      const draft = previous.drafts.at(-1); if (!draft) return fail('project_plan_draft_required');
      const plan = content(draft.plan); await effects.validate?.(projectId, structuredClone(plan));
      for (const task of participants(plan)) if (task.taskId) { const actual = await effects.readTask(projectId, task.taskId); if (actual.id !== task.taskId || actual.archivedAt) return fail('project_plan_task_unavailable'); }
      const existing = previous.confirmations.find(item => item.planVersion === draft.version);
      if (existing) {
        for (const receipt of existing.tasks) if (['created', 'not-required'].includes(receipt.createStatus)) { const actual = await effects.readTask(projectId, receipt.taskId); if (actual.id !== receipt.taskId || actual.archivedAt) return fail('project_plan_task_unavailable'); }
        // An explicit start after create-only expands authorization on the same
        // immutable plan and Task identities; it is not another Task creation.
        const promote = input.mode === 'start' && existing.mode === 'create';
        const resumePending = input.mode === 'start' && existing.mode === 'start' && existing.tasks.some(receipt => receipt.createStatus === 'pending' || ['created', 'not-required'].includes(receipt.createStatus) && receipt.startStatus === 'pending');
        const execute = promote || resumePending;
        const confirmation: ProjectPlanConfirmation = execute ? { ...existing, mode: 'start', authorizations: [...existing.authorizations, { operationId: input.operationId, mode: 'start', authorizedAt: new Date().toISOString() }], tasks: existing.tasks.map(receipt => ({ ...receipt, startStatus: receipt.startStatus === 'not-requested' && ['created', 'not-required'].includes(receipt.createStatus) ? 'pending' : receipt.startStatus })) } : existing;
        const next: RecordData = { ...previous, revision: previous.revision + 1, confirmations: previous.confirmations.map(item => item.id === existing.id ? confirmation : item), operations: [...previous.operations, { id: input.operationId, kind: 'confirm', fingerprint, version: draft.version, confirmationId: existing.id }] };
        await write(next); return { state: view(next), confirmation: structuredClone(confirmation), replayed: !execute };
      }
      const confirmation: ProjectPlanConfirmation = { id: input.operationId, projectId, planVersion: draft.version, confirmedAt: new Date().toISOString(), mode: input.mode, authorizations: [{ operationId: input.operationId, mode: input.mode, authorizedAt: new Date().toISOString() }], plan, tasks: participants(plan).map(task => ({ taskKey: task.key, taskId: task.taskId || stableId(projectId, input.operationId, task.key, 'task'), createRequestId: stableId(projectId, input.operationId, task.key, 'create'), startRequestId: stableId(projectId, input.operationId, task.key, 'start'), createStatus: task.taskId ? 'not-required' : 'pending', startStatus: input.mode === 'start' ? 'pending' : 'not-requested', observations: [] })) };
      const next: RecordData = { ...previous, revision: previous.revision + 1, confirmations: [...previous.confirmations, confirmation], operations: [...previous.operations, { id: input.operationId, kind: 'confirm', fingerprint, version: draft.version, confirmationId: confirmation.id }] };
      await write(next); return { state: view(next), confirmation: structuredClone(confirmation), replayed: false };
    });
    if (prepared.replayed) return prepared;
    // Effects are outside the persistence gate. This is not a background queue
    // and never prescribes a professional analysis order or waits for completion.
    await Promise.all(prepared.confirmation.tasks.map(async receipt => {
      const task = prepared.confirmation.plan.tasks.find(task => task.key === receipt.taskKey)!;
      const createBase = { confirmationId: prepared.confirmation.id, taskKey: receipt.taskKey, taskId: receipt.taskId, phase: 'create' as const, requestId: receipt.createRequestId };
      let created = ['created', 'not-required'].includes(receipt.createStatus);
      if (receipt.createStatus === 'pending') {
        await recordTaskResult(projectId, { ...createBase, status: 'unknown', code: 'operation_unresolved' });
        let result: Awaited<ReturnType<ProjectPlanEffects['createTask']>>;
        try { result = await effects.createTask({ projectId, taskId: receipt.taskId, task: structuredClone(task), origin: { confirmationId: prepared.confirmation.id, taskKey: task.key, requestHash: digest([projectId, prepared.confirmation.id, prepared.confirmation.planVersion, prepared.confirmation.plan, task.key]) }, requestId: receipt.createRequestId }); }
        catch { result = { status: 'unknown', code: 'create_result_unknown' }; }
        created = 'taskId' in result && result.taskId === receipt.taskId;
        if (created) await recordTaskResult(projectId, { ...createBase, status: 'created' });
        else await recordTaskResult(projectId, { ...createBase, status: 'taskId' in result ? 'unknown' : result.status, code: 'taskId' in result ? 'create_result_mismatch' : safeCode(result.code) || 'create_result_unknown' });
      }
      if (!created || input.mode !== 'start' || receipt.startStatus !== 'pending') return;
      const startBase = { confirmationId: prepared.confirmation.id, taskKey: receipt.taskKey, taskId: receipt.taskId, phase: 'start' as const, requestId: receipt.startRequestId };
      await recordTaskResult(projectId, { ...startBase, status: 'unknown', code: 'operation_unresolved' });
      let result: Awaited<ReturnType<ProjectPlanEffects['startTask']>>;
      try { result = await effects.startTask({ projectId, taskId: receipt.taskId, requestId: receipt.startRequestId, confirmation: structuredClone(prepared.confirmation), task: structuredClone(task) }); }
      catch { result = { status: 'unknown', code: 'start_result_unknown' }; }
      await recordTaskResult(projectId, { ...startBase, status: result.status, ...(safeCode(result.code) ? { code: result.code } : {}) });
    }));
    const state = await read(projectId), confirmation = state.history.find(item => item.id === prepared.confirmation.id)!;
    return { state, confirmation, replayed: false };
  }

  return { read, saveDraft, savePreparedDraft, confirm, recordTaskResult };
}
