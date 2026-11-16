import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { readNativeSessionSnapshot, createNativeSnapshotReadBudget } from './native-session-snapshot.ts';
import { buildProjectPlanPreparationPrompt, parseProjectPlanPreparationResponse, projectPlanPreparationInputHash } from './project-plan-preparation.ts';
import { parseProjectPlanContent, ProjectPlanFault, createProjectPlanStore } from './project-plan-store.ts';
import type { ProjectPlanDraftInput, ProjectPlanPreparationProjection, ProjectPlanCapabilities } from './project-plan-types.ts';
import type { ProjectStore } from './project-store.ts';
import type { createRequirementSessions } from './requirement-sessions.ts';
function fail(code: string, status = 409): never { throw new ProjectPlanFault(code, status); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const projectPlanPreparationOwner = (projectId: string) => `req-plan-${projectId}`;
export const projectPlanPreparationDirectory = (dataRoot: string, projectId: string) => path.join(dataRoot, 'project-plans', projectId, 'preparation');
export function createProjectPlanPreparationHost(options: {
  dataRoot: string; projects: ProjectStore; plans: ReturnType<typeof createProjectPlanStore>; sessions: ReturnType<typeof createRequirementSessions>;
  capabilities(projectId: string): Promise<ProjectPlanCapabilities>; validate(projectId: string, plan: ProjectPlanDraftInput['plan']): Promise<void>;
  mutate<T>(run: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
}) {
  async function receipts(projectId: string) {
    const directory = projectPlanPreparationDirectory(options.dataRoot, projectId), sessionDirectory = path.join(directory, 'sessions');
    let names: string[]; try { names = (await readdir(sessionDirectory)).filter(name => name.endsWith('.jsonl')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (names.length > 20) fail('project_plan_preparation_history_unavailable');
    const budget = createNativeSnapshotReadBudget(), results: (ProjectPlanPreparationProjection & { text?: string })[] = [];
    for (const name of names.sort()) {
      const snapshot = await readNativeSessionSnapshot(path.join(sessionDirectory, name), sessionDirectory, path.join(directory, 'workspace'), undefined, { budget });
      let active: (ProjectPlanPreparationProjection & { text?: string }) | undefined;
      for (const entry of snapshot.manager.getEntries()) {
        if (entry.type === 'custom' && entry.customType === 'optracall.run' && object(entry.data) && entry.data.sessionId === snapshot.manager.getSessionId()) {
          const data = entry.data;
          if (data.phase === 'started' && object(data.providedContext) && object(data.providedContext.projectPlanPreparation)) {
            const bound = data.providedContext.projectPlanPreparation;
            if (bound.projectId !== projectId || typeof data.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.requestId) || typeof bound.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(bound.inputHash)) fail('project_plan_preparation_history_unavailable');
            active = { operationId: data.requestId, inputHash: bound.inputHash, status: options.sessions.currentRequestId(projectPlanPreparationOwner(projectId)) === data.requestId ? 'running' : 'unknown' }; results.push(active);
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
    return { ...state, preparations: [...saved, ...original.filter(item => !saved.some(saved => saved.operationId === item.operationId)).map(({ text: _, ...item }) => ({ ...item, status: item.status === 'completed' ? 'unknown' as const : item.status }))] };
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
    const seed = { projectId, projectName: project.name, plan, capabilities: await options.capabilities(projectId), existingTasks: project.tasks.map(({ id, name, archivedAt }) => ({ id, name, archivedAt })) };
    const prompt = buildProjectPlanPreparationPrompt(seed);
    return { body: await options.sessions.withSession(projectPlanPreparationOwner(projectId), async lease => {
      const result = prior ? { outcome: 'completed', text: prior.text || '' } : await lease.run(prompt, input.operationId as string, async () => { if (!lease.isCurrent()) fail('project_plan_preparation_cancelled'); await options.validate(projectId, plan); }, { projectPlanPreparation: { projectId, inputHash, expectedRevision: request.expectedRevision } });
      if (result.outcome !== 'completed' || !lease.isCurrent()) { const current = await read(projectId); return { state: current, preparation: current.preparations?.find(item => item.operationId === input.operationId) || { operationId: input.operationId, inputHash, status: result.outcome }, replayed: !!prior }; }
      const output = parseProjectPlanPreparationResponse(result.text, seed); await options.validate(projectId, output.plan);
      const saved = await options.mutate(async () => { if (!lease.isCurrent() || options.isClosing()) fail('project_plan_preparation_cancelled'); return options.plans.savePreparedDraft(projectId, { ...request, plan: output.plan, requestHash: inputHash, mece: output.mece, limitations: output.limitations }); });
      return { ...saved, preparation: saved.state.preparations!.find(item => item.operationId === input.operationId)! };
    }) };
  }
  return { handle, read };
}
