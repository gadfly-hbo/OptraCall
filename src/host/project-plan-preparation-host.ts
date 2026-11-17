import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { readNativeSessionSnapshot, createNativeSnapshotReadBudget } from './native-session-snapshot.ts';
import { buildProjectPlanPreparationPrompt, parseProjectPlanPreparationResponse, projectPlanPreparationInputHash } from './project-plan-preparation.ts';
import { parseProjectPlanContent, ProjectPlanFault, createProjectPlanStore } from './project-plan-store.ts';
import type { ProjectPlanDraftInput, ProjectPlanPreparationProjection, ProjectPlanCapabilities } from './project-plan-types.ts';
import type { ProjectStore } from './project-store.ts';
import type { createRequirementSessions } from './requirement-sessions.ts';
import { canonicalDataContextValue } from './project-data-context-request.ts';
import { parseUsageContext, parseUsageContextOrigin } from './usage-context-types.ts';
import { parseGoalBasis } from './strategy-goals-types.ts';
type CapturedContext = Pick<ProjectPlanDraftInput['plan'], 'usageContext' | 'usageContextOrigin' | 'goalBasis'>;
function fail(code: string, status = 409): never { throw new ProjectPlanFault(code, status); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function capturedContext(value: unknown): CapturedContext {
  if (!object(value) || Object.keys(value).some(key => !['usageContext', 'usageContextOrigin', 'goalBasis'].includes(key)) || value.usageContextOrigin !== undefined && value.usageContext === undefined) fail('project_plan_preparation_history_unavailable');
  try { return { ...(value.usageContext === undefined ? {} : { usageContext: parseUsageContext(value.usageContext) }), ...(value.usageContextOrigin === undefined ? {} : { usageContextOrigin: parseUsageContextOrigin(value.usageContextOrigin) }), ...(value.goalBasis === undefined ? {} : { goalBasis: parseGoalBasis(value.goalBasis) }) }; }
  catch { return fail('project_plan_preparation_history_unavailable'); }
}
export const projectPlanPreparationOwner = (projectId: string) => `req-plan-${projectId}`;
export const projectPlanPreparationDirectory = (dataRoot: string, projectId: string) => path.join(dataRoot, 'project-plans', projectId, 'preparation');
function databaseProjection(capabilities: ProjectPlanCapabilities) {
  const rows = (kind: string, values: readonly { id: string; taskId?: string }[]) => values.map(value => ({ key: `${kind}:${value.taskId ?? 'project'}:${value.id}`, value: canonicalDataContextValue(JSON.parse(JSON.stringify(value))) }));
  // These are exactly the DB fields serialized by the preparation prompt.
  // Preserve the outgoing snapshot, rather than a global settings revision.
  return [
    ...rows('source', capabilities.databaseSources || []),
    ...rows('connector', capabilities.connectors.filter(ref => ref.id.startsWith('db-link:')).map(({ id, title, enabled, requiresPermission, permissionRef, version, sha256, taskId }) => ({ id, title, enabled, requiresPermission, permissionRef, version, sha256, taskId }))),
    ...rows('material', capabilities.materials.filter(ref => ref.kind === 'connector' && ref.id.startsWith('db-link:')).map(({ kind, id, version, sha256, permissionRef, title, enabled }) => ({ kind, id, version, sha256, permissionRef, title, ...(enabled === undefined ? {} : { enabled }) }))),
  ];
}
function assertSelectedDatabaseSources(plan: ProjectPlanDraftInput['plan'], capabilities: ProjectPlanCapabilities) {
  const visible = capabilities.databaseSources || [];
  const allowed = (ref: { id: string; version?: string; sha256?: string; permissionRef?: string }, taskId?: string) => visible.some(source => source.taskId === taskId && source.id === ref.id && source.version === ref.version && source.sha256 === ref.sha256 && source.permissionRef === ref.permissionRef);
  if (plan.materials.some(ref => ref.kind === 'connector' && ref.id.startsWith('db-link:') && !allowed(ref)) || plan.tasks.some(task => task.capabilities.some(ref => ref.kind === 'connector' && ref.id.startsWith('db-link:') && !allowed(ref, task.taskId)))) fail('project_plan_source_model_permission_required', 403);
}
export function createProjectPlanPreparationHost(options: {
  dataRoot: string; projects: ProjectStore; plans: ReturnType<typeof createProjectPlanStore>; sessions: ReturnType<typeof createRequirementSessions>;
  capabilities(projectId: string, read?: { modelOutlet?: string }): Promise<ProjectPlanCapabilities>; validate(projectId: string, plan: ProjectPlanDraftInput['plan']): Promise<void>;
  goalContent?(projectId: string, plan: ProjectPlanDraftInput['plan']): Promise<readonly import('./strategy-goals-types.ts').GoalVersion[]>;
  goalEvidence?(projectId: string, plan: ProjectPlanDraftInput['plan']): Promise<import('./project-plan-preparation.ts').ProjectPlanPreparationInput['goalEvidence']>;
  prepareContext?(projectId: string, plan: ProjectPlanDraftInput['plan']): Promise<ProjectPlanDraftInput['plan']>;
  capabilityIssues?(projectId: string, plan: ProjectPlanDraftInput['plan']): Promise<import('./project-plan-preparation.ts').ProjectPlanPreparationInput['capabilityIssues']>;
  mutate<T>(run: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
}) {
  async function receipts(projectId: string) {
    const directory = projectPlanPreparationDirectory(options.dataRoot, projectId), sessionDirectory = path.join(directory, 'sessions');
    let names: string[]; try { names = (await readdir(sessionDirectory)).filter(name => name.endsWith('.jsonl')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (names.length > 20) fail('project_plan_preparation_history_unavailable');
    const budget = createNativeSnapshotReadBudget(), results: (ProjectPlanPreparationProjection & { text?: string; capturedContext?: CapturedContext })[] = [];
    for (const name of names.sort()) {
      const snapshot = await readNativeSessionSnapshot(path.join(sessionDirectory, name), sessionDirectory, path.join(directory, 'workspace'), undefined, { budget });
      let active: (ProjectPlanPreparationProjection & { text?: string; capturedContext?: CapturedContext }) | undefined;
      for (const entry of snapshot.manager.getEntries()) {
        if (entry.type === 'custom' && entry.customType === 'optracall.run' && object(entry.data) && entry.data.sessionId === snapshot.manager.getSessionId()) {
          const data = entry.data;
          if (data.phase === 'started' && object(data.providedContext) && object(data.providedContext.projectPlanPreparation)) {
            const bound = data.providedContext.projectPlanPreparation;
            if (bound.projectId !== projectId || typeof data.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.requestId) || typeof bound.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(bound.inputHash)) fail('project_plan_preparation_history_unavailable');
            active = { operationId: data.requestId, inputHash: bound.inputHash, status: options.sessions.currentRequestId(projectPlanPreparationOwner(projectId)) === data.requestId ? 'running' : 'unknown', ...(bound.capturedContext === undefined ? {} : { capturedContext: capturedContext(bound.capturedContext) }) }; results.push(active);
          } else if (data.phase === 'settled' && active && active.operationId === data.requestId && ['completed', 'cancelled', 'failed'].includes(String(data.outcome))) active.status = data.outcome as 'completed' | 'cancelled' | 'failed';
        } else if (active && entry.type === 'message' && entry.message.role === 'assistant') active.text = typeof entry.message.content === 'string' ? entry.message.content : entry.message.content.filter(part => part.type === 'text').map(part => part.text).join('');
      }
    }
    const ids = new Set<string>(); for (const result of results) { if (ids.has(result.operationId)) fail('project_plan_preparation_history_unavailable'); ids.add(result.operationId); }
    return results;
  }
  async function read(projectId: string) {
    const state = await options.plans.read(projectId), saved = state.preparations || [];
    const original = await receipts(projectId);
    return { ...state, preparations: [...saved, ...original.filter(item => !saved.some(saved => saved.operationId === item.operationId)).map(({ text: _, capturedContext: __, ...item }) => ({ ...item, status: item.status === 'completed' ? 'unknown' as const : item.status }))] };
  }
  async function handle(projectId: string, action: string, method: string, input: Record<string, unknown>) {
    if (action === 'plan' && method === 'GET') { await options.projects.get(projectId); return { body: await read(projectId) }; }
    if (action !== 'plan/prepare' && action !== 'plan/prepare/stop' || method !== 'POST') return null;
    if (typeof input.operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.operationId)) fail('invalid_project_plan_mutation', 400);
    if (options.isClosing()) fail('host_closing');
    const project = await options.projects.get(projectId); if (project.archivedAt) fail('project_archived');
    const prior = (await receipts(projectId)).find(item => item.operationId === input.operationId);
    if (action.endsWith('/stop')) {
      if (Object.keys(input).some(key => key !== 'operationId')) fail('invalid_project_plan_mutation', 400);
      if (!prior || prior.status !== 'running') return { body: { stopped: false, preparation: prior && { ...prior, text: undefined } } };
      const stopped = await options.sessions.stop(projectPlanPreparationOwner(projectId), { expectedRequestId: input.operationId });
      const preparation = (await read(projectId)).preparations?.find(item => item.operationId === input.operationId);
      return { body: { stopped, preparation } };
    }
    if (Object.keys(input).some(key => !['operationId', 'expectedRevision', 'plan'].includes(key)) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) fail('invalid_project_plan_mutation', 400);
    const plan = parseProjectPlanContent(input.plan), request = { operationId: input.operationId, expectedRevision: Number(input.expectedRevision), plan }, inputHash = projectPlanPreparationInputHash(request);
    const state = await read(projectId), saved = state.preparations?.find(item => item.operationId === input.operationId && item.draftVersion !== undefined);
    if (saved) { if (saved.inputHash !== inputHash) fail('project_plan_operation_conflict'); return { body: { state, draft: state.draft?.version === saved.draftVersion ? state.draft : undefined, preparation: saved, replayed: true } }; }
    if (prior && prior.inputHash !== inputHash) fail('project_plan_operation_conflict');
    if (prior && prior.status !== 'completed') return { body: { state, preparation: { ...prior, text: undefined }, replayed: true } };
    if (state.revision !== request.expectedRevision) fail('project_plan_conflict');
    await options.validate(projectId, plan);
    return { body: await options.sessions.withSession(projectPlanPreparationOwner(projectId), async lease => {
      const selected = prior ? { ...plan, ...prior.capturedContext } : await options.prepareContext?.(projectId, plan) ?? plan;
      const frozen = capturedContext({ ...(selected.usageContext === undefined ? {} : { usageContext: selected.usageContext }), ...(selected.usageContextOrigin === undefined ? {} : { usageContextOrigin: selected.usageContextOrigin }), ...(selected.goalBasis === undefined ? {} : { goalBasis: selected.goalBasis }) });
      const seed = { projectId, projectName: project.name, plan: selected, goalContent: await options.goalContent?.(projectId, selected), goalEvidence: await options.goalEvidence?.(projectId, selected), capabilityIssues: await options.capabilityIssues?.(projectId, selected), capabilities: structuredClone(await options.capabilities(projectId, { modelOutlet: lease.modelIdentity.outlet })), existingTasks: project.tasks.map(({ id, name, archivedAt }) => ({ id, name, archivedAt })) };
      // The local UI can see sources which this particular preparation model
      // cannot. Check the original selected references too, before serializing
      // any of them into a model request. Keep the user's selection unchanged.
      assertSelectedDatabaseSources(selected, seed.capabilities);
      const prompt = buildProjectPlanPreparationPrompt(seed);
      const outgoingDatabase = databaseProjection(seed.capabilities);
      const result = prior ? { outcome: 'completed', text: prior.text || '' } : await lease.run(prompt, input.operationId as string, async () => {
        if (!lease.isCurrent()) fail('project_plan_preparation_cancelled');
        // The original domain calls this inside its mutation gate, after worker
        // opening and immediately before the first actual dispatch.
        const current = await options.capabilities(projectId, { modelOutlet: lease.modelIdentity.outlet });
        const currentDatabase = new Map(databaseProjection(current).map(row => [row.key, row.value]));
        if (outgoingDatabase.some(row => currentDatabase.get(row.key) !== row.value)) fail('project_plan_source_permissions_changed', 403);
        assertSelectedDatabaseSources(selected, current);
        await options.validate(projectId, selected);
        if (!lease.isCurrent()) fail('project_plan_preparation_cancelled');
      }, { projectPlanPreparation: { projectId, inputHash, expectedRevision: request.expectedRevision, capturedContext: frozen } });
      if (result.outcome !== 'completed' || !lease.isCurrent()) { const current = await read(projectId); return { state: current, preparation: current.preparations?.find(item => item.operationId === input.operationId) || { operationId: input.operationId, inputHash, status: result.outcome }, replayed: !!prior }; }
      const output = parseProjectPlanPreparationResponse(result.text, seed); await options.validate(projectId, output.plan);
      const saved = await options.mutate(async () => { if (!lease.isCurrent() || options.isClosing()) fail('project_plan_preparation_cancelled'); return options.plans.savePreparedDraft(projectId, { ...request, plan: output.plan, requestHash: inputHash, mece: output.mece, limitations: output.limitations }); });
      return { ...saved, preparation: saved.state.preparations!.find(item => item.operationId === input.operationId)! };
    }) };
  }
  return { handle, read };
}
