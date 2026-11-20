import { parseCaseCreationSource, readCaseOriginRevision } from './case-creation-source.ts';
import type { StrategyGoalsStore } from './strategy-goals-store.ts';
import { assertAdoptedGoalRefs } from './strategy-goals-routes.ts';
import { randomUUID } from 'node:crypto';
import { CaseStore, CaseStoreError } from './case-store.ts';
import type { CaseCreationSource, ArtifactAdoption, CaseArtifactRecord, CaseArtifactView, CaseStatus, ProjectWorkStatus } from './case-types.ts';
import type { ConfigurationStore } from './config-store.ts';
import { ProjectStore, type ProjectRecord } from './project-store.ts';

export class CaseRouteError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  constructor(code: string, statusCode: number, details?: Record<string, unknown>) {
    super(code); this.code = code; this.statusCode = statusCode; this.details = details;
  }
}
type RouteRequest = { pathname: string; method: string; input?: Record<string, unknown> };
type RouteResult = { status?: number; body: unknown } | null;
export interface CaseEnterpriseScopeHooks {
  caseEnterpriseId(caseId: string): string | undefined;
  projectEnterpriseId(projectId: string): string | undefined;
  defaultEnterpriseId?(): string | undefined;
  assignCase(caseId: string, enterpriseId: string): void | Promise<void>;
  assignProject(projectId: string, enterpriseId: string): void | Promise<void>;
}
type Dependencies = {
  cases: CaseStore; projects: ProjectStore; configuration: ConfigurationStore;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>;
  assertActive: (project: ProjectRecord) => void;
  decorateProject: (project: ProjectRecord) => unknown | Promise<unknown>;
  enterpriseScope?: CaseEnterpriseScopeHooks; goals?: StrategyGoalsStore;
  validateGoal?: (goal: import('./strategy-goals-types.ts').GoalVersion) => Promise<void>;
  readSource?: import('./personal-retention-types.ts').ReadPersonalSource;
};
function string(value: unknown): string {
  if (typeof value !== 'string') throw new CaseStoreError('invalid_text');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number') throw new CaseStoreError('invalid_revision');
  return value;
}
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : string(value); }
function nullableString(value: unknown): string | null { return value == null ? null : string(value); }
function mutation(input: Record<string, unknown>) { return { operationId: string(input.operationId), expectedRevision: number(input.expectedRevision) }; }

/** Case routes share the Host lifecycle queue; original project identity stays in ProjectStore. */
export function createCaseRoutes({ cases, projects, configuration, mutate, assertActive, decorateProject, enterpriseScope, goals, validateGoal, readSource }: Dependencies) {
  const enterpriseForLink = (caseId: string, projectId?: string, useDefault = false): string | undefined => {
    if (!enterpriseScope) return undefined;
    const known = [enterpriseScope.caseEnterpriseId(caseId), ...cases.listProjectLinks(caseId).map(link => enterpriseScope.projectEnterpriseId(link.projectId)), ...(projectId ? [enterpriseScope.projectEnterpriseId(projectId)] : [])].filter((id): id is string => id !== undefined);
    const scopes = new Set(known);
    if (scopes.size > 1) throw new CaseRouteError('case_enterprise_conflict', 409, { caseId, ...(projectId ? { projectId } : {}) });
    return known[0] ?? (useDefault ? enterpriseScope.defaultEnterpriseId?.() : undefined);
  };
  const recordEnterprise = async (caseId: string, projectId: string | undefined, enterpriseId: string | undefined, details: Record<string, unknown>) => {
    if (!enterpriseScope || !enterpriseId) return;
    const before = enterpriseForLink(caseId, projectId);
    if (before !== undefined && before !== enterpriseId) throw new CaseRouteError('case_enterprise_conflict', 409, { ...details, caseId, ...(projectId ? { projectId } : {}) });
    try {
      if (!enterpriseScope.caseEnterpriseId(caseId)) await enterpriseScope.assignCase(caseId, enterpriseId);
      if (projectId && !enterpriseScope.projectEnterpriseId(projectId)) await enterpriseScope.assignProject(projectId, enterpriseId);
    } catch { throw new CaseRouteError('case_enterprise_assignment_incomplete', 503, { ...details, caseId, ...(projectId ? { projectId } : {}) }); }
    const actual = enterpriseForLink(caseId, projectId);
    if (actual !== enterpriseId) throw new CaseRouteError('case_enterprise_conflict', 409, { ...details, caseId, ...(projectId ? { projectId } : {}) });
    if (enterpriseScope.caseEnterpriseId(caseId) !== enterpriseId || projectId && enterpriseScope.projectEnterpriseId(projectId) !== enterpriseId)
      throw new CaseRouteError('case_enterprise_assignment_incomplete', 503, { ...details, caseId, ...(projectId ? { projectId } : {}) });
  };
  async function sourceEnterprise(source: CaseCreationSource) {
    if (source.kind === 'case') {
      if (cases.getCase(source.caseId).revision !== source.caseRevision) throw new CaseRouteError('case_revision_conflict', 409);
      return enterpriseForLink(source.caseId);
    }
    const project = await projects.get(source.projectId); assertActive(project);
    if (!project.tasks.some(task => task.id === source.taskId && !task.archivedAt)) throw new CaseRouteError('task_not_found', 404);
    if (source.reply && (await readSource?.(source.reply, { audience: 'human' }))?.status !== 'available') throw new CaseRouteError('case_issue_reply_unavailable', 409);
    return enterpriseScope?.projectEnterpriseId(source.projectId);
  }
  async function bindingEnterprise(binding: import('./case-types.ts').CaseGoalBindingInput, owner?: string) {
    if (!goals) return owner;
    const scopes = new Set(owner ? [owner] : []);
    for (const ref of [binding.primary, ...binding.related]) {
      const version = goals.read(ref); await validateGoal?.(version);
      const enterprise = version.scope.kind === 'enterprise' ? version.scope.id : version.scope.enterpriseId;
      if (enterprise) scopes.add(enterprise);
    }
    if (scopes.size > 1) throw new CaseRouteError('case_enterprise_conflict', 409);
    return [...scopes][0];
  }
  async function artifactView(artifact: CaseArtifactRecord, linked: Set<string>, adoption?: ArtifactAdoption): Promise<CaseArtifactView> {
    let project: ProjectRecord | undefined;
    try { project = await projects.get(artifact.projectId); } catch { /* A missing original project is a broken reference, never a new project. */ }
    const source = { ...(project ? { projectName: project.name } : {}), ...(adoption ? { adoptedVersion: adoption } : {}), ...(artifact.taskId && project?.tasks.some(task => task.id === artifact.taskId) ? { taskName: project.tasks.find(task => task.id === artifact.taskId)!.name } : {}) };
    if (artifact.unlinkedAt) return { ...artifact, ...source, availability: 'unlinked' };
    if (!linked.has(artifact.projectId)) return { ...artifact, ...source, availability: 'project_unlinked' };
    if (!project) return { ...artifact, ...source, availability: 'inaccessible' };
    try {
      const observation = await projects.observeFile(artifact.projectId, artifact.relativePath);
      const changed = artifact.observedSha256 !== null && (artifact.observedSha256 !== observation.sha256 || artifact.observedBytes !== observation.bytes);
      return { ...artifact, ...source, availability: changed ? 'changed' : 'available' };
    } catch (error) {
      return { ...artifact, ...source, availability: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'inaccessible' };
    }
  }
  async function createProjectAndLink(caseId: string, input: Record<string, unknown>) {
    const common = mutation(input), projectInput = { name: string(input.name), configurationId: string(input.configurationId) };
    const previous = cases.getOperation(common.operationId), projectId = previous?.projectId ?? randomUUID();
    // Reserve validates the complete original payload even when replaying a completed operation.
    const scope = !previous && enterpriseScope ? { enterpriseScopeIntent: enterpriseForLink(caseId, projectId, true) ?? null } : undefined;
    let receipt = cases.reserveProjectCreation({ ...common, caseId, projectId, projectInput }, scope);
    let project: ProjectRecord | null = null;
    if (receipt.phase === 'prepared') {
      const selected = configuration.read(projectInput.configurationId);
      if (!selected?.hasApiKey) throw new CaseRouteError('configuration_required', 409);
      enterpriseForLink(caseId, projectId);
      await recordEnterprise(caseId, undefined, receipt.enterpriseScopeIntent ?? undefined, { operationId: common.operationId, projectId, projectCreated: false });
      try {
        project = await projects.create({ name: projectInput.name, configuration: selected, reservedId: projectId });
      } catch (error) {
        // Partial directories or an identity collision cannot safely be guessed or retried.
        cases.markProjectNeedsReview(common.operationId, (error as { code?: string }).code ?? 'project_creation_failed');
        receipt = cases.getOperation(common.operationId)!;
        return { project: null, operationId: common.operationId, projectId, linked: false, phase: receipt.phase };
      }
      try { cases.markProjectCreated(common.operationId); }
      catch { throw new CaseRouteError('project_creation_receipt_unknown', 503, { operationId: common.operationId, projectId, projectCreated: true }); }
      receipt = cases.getOperation(common.operationId)!;
    }
    if (!project) { try { project = await projects.get(projectId); } catch { /* Preserve the receipt and original identity. */ } }
    if (receipt.phase === 'project_created' && project) {
      // Reconcile enterprise metadata against this exact reserved project before
      // the original Case authority commits its link. A failed hook leaves the
      // existing project_created receipt and identity available for inspection.
      enterpriseForLink(caseId, projectId);
      await recordEnterprise(caseId, projectId, receipt.enterpriseScopeIntent ?? undefined, { operationId: common.operationId, projectCreated: true });
      try {
        const result = cases.completeProjectCreation(common.operationId);
        return { project: await decorateProject(project), case: result.case, operationId: common.operationId, projectId, linked: true, phase: 'completed' };
      } catch (error) {
        if (!(error instanceof CaseStoreError) || !['case_revision_conflict', 'case_closed'].includes(error.code)) throw new CaseRouteError('project_link_incomplete', 409, { operationId: common.operationId, projectId, projectCreated: true });
        return { project: await decorateProject(project), operationId: common.operationId, projectId, linked: false, phase: 'project_created' };
      }
    }
    if (receipt.phase === 'project_created' && !project) {
      cases.markProjectNeedsReview(common.operationId, 'created_project_unavailable');
      receipt = cases.getOperation(common.operationId)!;
    }
    if (receipt.phase === 'completed' && project) await recordEnterprise(caseId, projectId, receipt.enterpriseScopeIntent ?? undefined, { operationId: common.operationId, projectCreated: true, linkCreated: true });
    return { project: project ? await decorateProject(project) : null, operationId: common.operationId, projectId, linked: receipt.phase === 'completed', phase: receipt.phase,
      ...(receipt.phase === 'completed' && receipt.result?.case ? { case: receipt.result.case } : {}) };
  }
  async function adoptArtifact(caseId: string, input: Record<string, unknown>) {
    const command = { ...mutation(input), caseId, projectId: string(input.projectId), relativePath: string(input.relativePath), taskId: nullableString(input.taskId), role: (input.role ?? 'file') as CaseArtifactRecord['role'], displayName: nullableString(input.displayName) };
    const previous = cases.getOperation(command.operationId);
    if (previous) {
      const receipt = cases.reserveArtifactAdoption(command); // Validate the entire original command before returning its receipt.
      if (receipt.phase === 'completed') return receipt.result;
      if (receipt.phase === 'prepared') cases.markArtifactAdoptionNeedsReview(command.operationId);
      throw new CaseRouteError('artifact_adoption_needs_review', 409, { operationId: command.operationId, projectId: command.projectId });
    }
    const project = await projects.get(command.projectId); assertActive(project);
    if (command.taskId && !project.tasks.some(task => task.id === command.taskId)) throw new CaseRouteError('task_not_found', 404);
    cases.reserveArtifactAdoption(command);
    try {
      const saved = await projects.saveArtifactVersion(command.projectId, command.relativePath, command.operationId);
      return cases.completeArtifactAdoption(command.operationId, { relativePath: saved.file.path, uploadId: saved.file.id, sha256: saved.source.sha256, bytes: saved.source.bytes, sourceObservedAt: saved.source.observedAt, savedAt: saved.file.uploadedAt });
    } catch (error) {
      // A copy may already exist. Keep it and the receipt for inspection; never copy or replay automatically.
      const receipt = cases.getOperation(command.operationId);
      if (receipt?.phase === 'completed') return receipt.result;
      const code = (error as { code?: string }).code;
      cases.markArtifactAdoptionNeedsReview(command.operationId, code === 'ENOENT' ? 'source_unavailable' : code === 'unsafe_file_path' ? 'source_unsafe' : code === 'file_changed_during_observation' ? 'source_changed' : code === 'upload_too_large' ? 'source_too_large' : code === 'upload_name_conflict' ? 'name_conflict' : 'save_or_link_failed');
      throw new CaseRouteError('artifact_adoption_needs_review', 409, { operationId: command.operationId, projectId: command.projectId });
    }
  }
  return async function handle({ pathname, method, input = {} }: RouteRequest): Promise<RouteResult> {
    if (pathname === '/api/cases/storage' && method === 'GET') return { body: cases.getStatus() };
    if (pathname === '/api/cases/storage/initialize' && method === 'POST') return { body: await mutate(() => cases.initialize()) };
    if(pathname==='/api/cases/goal-match' && method==='POST' && goals){
      const binding=assertAdoptedGoalRefs(goals,{primary:input.primary,related:[],strategy:input.strategy},'binding');
      if(!binding.strategy)throw new CaseRouteError('case_strategy_required',400);
      await bindingEnterprise(binding);
      return {body:{caseId:cases.caseForGoalStrategy(binding.primary,binding.strategy)}};
    }
    if (pathname === '/api/cases') {
      if (method === 'GET') return { body: { cases: cases.listCases(), projectLinks: cases.listProjectLinks() } };
      if (method === 'POST') return { status: 201, body: await mutate(async () => {
        const operationId = string(input.operationId), previous = cases.getOperation(operationId);
        const goalBinding = previous ? input.goalBinding as import('./case-types.ts').CaseGoalBindingInput | undefined : goals ? assertAdoptedGoalRefs(goals, input.goalBinding, 'new-case') : undefined;
        const creationSource = input.creationSource === undefined ? undefined : parseCaseCreationSource(input.creationSource);
        const sourceScope = !previous && creationSource ? await sourceEnterprise(creationSource) : undefined;
        const enterprise = !previous && goalBinding ? await bindingEnterprise(goalBinding, sourceScope) : sourceScope;
        const scope = !previous && enterpriseScope ? { enterpriseScopeIntent: enterprise ?? enterpriseScope.defaultEnterpriseId?.() ?? null } : undefined;
        const record = cases.createCase({ operationId, title: string(input.title), description: optionalString(input.description), ...(goalBinding ? { goalBinding } : {}), ...(creationSource ? { creationSource } : {}) }, scope);
        await recordEnterprise(record.id, undefined, cases.getOperation(operationId)?.enterpriseScopeIntent ?? undefined, { operationId, caseCreated: true });
        return { case: record };
      }) };
    }
    const operationMatch = /^\/api\/cases\/operations\/([a-f0-9-]+)$/.exec(pathname);
    if (operationMatch && method === 'GET') {
      const operation = cases.getOperation(operationMatch[1]!);
      if (operation?.kind === 'case_create' && operation.enterpriseScopeIntent && operation.caseId && enterpriseScope?.caseEnterpriseId(operation.caseId) !== operation.enterpriseScopeIntent)
        throw new CaseRouteError('case_enterprise_assignment_incomplete',503,{operationId:operation.operationId,caseId:operation.caseId});
      return { body: { operation } };
    }
    const workMatch = /^\/api\/projects\/([a-f0-9-]+)\/work(?:\/(events|notes))?$/.exec(pathname);
    if (workMatch) {
      const projectId = workMatch[1]!, action = workMatch[2];
      if (method === 'GET') {
        await projects.get(projectId);
        if (!action) return { body: { work: cases.getProjectWork(projectId) } };
        if (action === 'events') return { body: { events: cases.getEvents('project', projectId) } };
      }
      if ((!action && method === 'PATCH') || (action === 'notes' && method === 'POST')) return { body: await mutate(async () => {
        const common = { ...mutation(input), projectId, originCaseId: optionalString(input.originCaseId) };
        // Replaying a completed save only reads its immutable receipt. Fresh
        // writes still re-check archive admission inside the shared Host gate.
        if (cases.getOperation(common.operationId)?.phase !== 'completed') assertActive(await projects.get(projectId));
        if (action === 'notes') return { work: cases.addProjectWorkNote({ ...common, note: string(input.note), feedbackSource: nullableString(input.feedbackSource) }) };
        return { work: cases.saveProjectWork({ ...common, workStatus: input.workStatus as ProjectWorkStatus | null, workScope: string(input.workScope), assignee: nullableString(input.assignee), nextStep: string(input.nextStep), ...(Object.hasOwn(input, 'statusReason') ? { statusReason: nullableString(input.statusReason) } : {}) }) };
      }) };
      return null;
    }
    const match = /^\/api\/cases\/([a-f0-9-]+)(?:\/(.*))?$/.exec(pathname);
    if (!match) return null;
    const caseId = match[1]!, action = match[2];
    const boundRevision=/^goals\/revisions\/([1-9]\d*)$/.exec(action??'');
    if(boundRevision&&method==='GET'){
      const original=readCaseOriginRevision(cases,{kind:'case',caseId,caseRevision:Number(boundRevision[1])});
      return {body:{goalBinding:original.goalBinding??null}};
    }
    if (action === 'origin/reply' && method === 'GET') {
      cases.getCase(caseId);
      const origin = cases.getEvents('case',caseId).find(e => e.eventType === 'case_created')?.changes.creationSource?.after as CaseCreationSource | undefined;
      if (origin?.kind !== 'task' || !origin.reply) throw new CaseRouteError('case_issue_reply_unavailable',404);
      const project = await projects.get(origin.projectId);
      if (!project.tasks.some(t => t.id === origin.taskId)) throw new CaseRouteError('task_not_found',404);
      const owner = enterpriseForLink(caseId), current = enterpriseScope?.projectEnterpriseId(origin.projectId);
      if (owner && current && owner !== current) throw new CaseRouteError('case_enterprise_conflict',409);
      const original = await readSource?.(origin.reply,{audience:'human'});
      if (original?.status !== 'available' || original.sha256 !== origin.reply.expectedTextSha256 || !original.text) throw new CaseRouteError('case_issue_reply_unavailable',409);
      return {body:{text:original.text}};
    }
    if (!action && method === 'GET') {
      const record = cases.getCase(caseId), projectLinks = cases.listProjectLinks(caseId), linked = new Set(projectLinks.map(link => link.projectId));
      const adoptions = cases.getArtifactAdoptions(caseId);
      const events = cases.getEvents('case', caseId), creationSource = events.find(e => e.eventType === 'case_created')?.changes.creationSource?.after as CaseCreationSource | undefined;
      return { body: { case: record, ...(creationSource ? { creationSource } : {}), goalBinding: cases.getGoalBinding(caseId), projectLinks, artifacts: await Promise.all(cases.getArtifacts(caseId, { includeUnlinked: true }).map(artifact => artifactView(artifact, linked, adoptions.get(artifact.id)))), pendingOperations: [...cases.listPendingProjectOperations(caseId), ...cases.listPendingArtifactAdoptions(caseId)], events, projectEvents: projectLinks.flatMap(link => cases.getEvents('project', link.projectId)) } };
    }
    if (action === 'goals') {
      if (method === 'GET') return { body: { goalBinding: cases.getGoalBinding(caseId), binding: cases.getGoalBinding(caseId), history: cases.getGoalBindingHistory(caseId) } };
      if (method === 'POST' && goals) return { body: await mutate(async () => {
        const binding = assertAdoptedGoalRefs(goals, input.goalBinding);
        await bindingEnterprise(binding, enterpriseForLink(caseId));
        const prior = cases.getGoalBinding(caseId);
        if (prior?.strategy && !binding.strategy) throw new CaseRouteError('case_strategy_required', 400);
        if (binding.effectiveFrom && prior) {
          const original = goals.read(prior.primary), next = goals.read(binding.primary);
          if (JSON.stringify(original.measurement) !== JSON.stringify(next.measurement) || original.scope.kind !== next.scope.kind || original.scope.id !== next.scope.id) throw new CaseRouteError('case_new_issue_requires_new_case', 409);
        }
        if (binding.effectiveFrom && input.continuityConfirmed !== true) throw new CaseRouteError('case_continuity_confirmation_required', 409);
        const saved = cases.setGoalBinding({ ...mutation(input), caseId, ...binding });
        return { binding: saved, goalBinding: saved };
      }) };
    }
    if (!action && method === 'PATCH') return { body: await mutate(() => ({ case: cases.updateCase({ ...mutation(input), caseId, title: string(input.title), description: string(input.description), judgement: string(input.judgement), nextStep: string(input.nextStep) }) })) };
    if (method === 'POST' && ['status', 'close', 'reopen', 'notes'].includes(action ?? '')) return { body: await mutate(() => {
      const common = { ...mutation(input), caseId };
      if (action === 'status') return { case: cases.updateCase({ ...common, status: string(input.status) as CaseStatus }) };
      if (action === 'close') return { case: cases.closeCase({ ...common, closeReason: string(input.reason) }) };
      if (action === 'reopen') return { case: cases.reopenCase({ ...common, status: string(input.status) as CaseStatus }) };
      return { case: cases.addCaseNote({ ...common, note: string(input.note), feedbackSource: nullableString(input.feedbackSource) }) };
    }) };
    if (action === 'projects' && method === 'POST') return { body: await mutate(async () => {
      const projectId = string(input.projectId); await projects.get(projectId);
      const common = mutation(input), previous = cases.getOperation(common.operationId), recoveryOf = optionalString(input.recoveryOfOperationId);
      // Native receipts validate replay payloads and retain the original scope.
      // A retry repairs only that association, never guesses from later defaults.
      const recoveryIntent = !previous && recoveryOf ? cases.getOperation(recoveryOf)?.enterpriseScopeIntent : undefined;
      const scope = !previous && enterpriseScope ? { enterpriseScopeIntent: recoveryIntent ?? enterpriseForLink(caseId, projectId) ?? null } : undefined;
      if (scope?.enterpriseScopeIntent) {
        const current = enterpriseForLink(caseId, projectId);
        if (current !== undefined && current !== scope.enterpriseScopeIntent) throw new CaseRouteError('case_enterprise_conflict', 409, { caseId, projectId });
      }
      const result = cases.linkProject({ ...common, caseId, projectId, recoveryOf }, scope);
      await recordEnterprise(caseId, projectId, cases.getOperation(common.operationId)?.enterpriseScopeIntent ?? undefined, { operationId: common.operationId, linkCreated: true });
      return result;
    }) };
    if (action === 'projects/create' && method === 'POST') return { status: 201, body: await mutate(() => createProjectAndLink(caseId, input)) };
    const projectMatch = /^projects\/([a-f0-9-]+)$/.exec(action ?? '');
    if (projectMatch && method === 'DELETE') return { body: await mutate(() => cases.unlinkProject({ ...mutation(input), caseId, projectId: projectMatch[1]! })) };
    if (action === 'artifacts/adopt' && method === 'POST') return { body: await mutate(() => adoptArtifact(caseId, input)) };
    if (action === 'artifacts' && method === 'POST') return { body: await mutate(async () => {
      const common = mutation(input), projectId = string(input.projectId), relativePath = string(input.relativePath), taskId = nullableString(input.taskId);
      const prior = cases.getOperation(common.operationId);
      // The observation belongs to the original save. A retry must not replace
      // its time/hash or fail merely because that file has since changed/moved.
      const saved = prior?.kind === 'artifact_save' && prior.phase === 'completed' ? prior.result?.artifact as CaseArtifactRecord | undefined : undefined;
      let observation: { sha256: string | null; bytes: number | null; observedAt: string | null }, uploadId: string | null;
      if (saved) { observation = { sha256: saved.observedSha256, bytes: saved.observedBytes, observedAt: saved.observedAt }; uploadId = saved.uploadId; }
      else {
        const project = await projects.get(projectId);
        assertActive(project);
        if (taskId && !project.tasks.some(task => task.id === taskId)) throw new CaseRouteError('task_not_found', 404);
        observation = await projects.observeFile(projectId, relativePath);
        uploadId = project.uploads.find(upload => upload.path === relativePath)?.id ?? null;
      }
      if (input.expectedSha256 !== undefined && (typeof input.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedSha256) || observation.sha256 !== input.expectedSha256)) throw new CaseRouteError('artifact_version_changed', 409);
      return cases.saveArtifact({ ...common, caseId, projectId, relativePath, taskId, uploadId,
        role: (input.role ?? 'file') as CaseArtifactRecord['role'], displayName: nullableString(input.displayName), observedSha256: observation.sha256, observedBytes: observation.bytes, observedAt: observation.observedAt });
    }) };
    const artifactMatch = /^artifacts\/([a-f0-9-]+)$/.exec(action ?? '');
    if (artifactMatch && method === 'DELETE') return { body: await mutate(() => cases.unlinkArtifact({ ...mutation(input), caseId, artifactId: artifactMatch[1]! })) };
    return null;
  };
}
