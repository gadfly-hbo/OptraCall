import { randomUUID } from 'node:crypto';
import { CaseStore, CaseStoreError } from './case-store.ts';
import type { CaseArtifactRecord, CaseArtifactView, CaseStatus, ProjectWorkStatus } from './case-types.ts';
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
type Dependencies = {
  cases: CaseStore; projects: ProjectStore; configuration: ConfigurationStore;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>;
  assertActive: (project: ProjectRecord) => void;
  decorateProject: (project: ProjectRecord) => unknown | Promise<unknown>;
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
export function createCaseRoutes({ cases, projects, configuration, mutate, assertActive, decorateProject }: Dependencies) {
  async function artifactView(artifact: CaseArtifactRecord, linked: Set<string>): Promise<CaseArtifactView> {
    let project: ProjectRecord | undefined;
    try { project = await projects.get(artifact.projectId); } catch { /* A missing original project is a broken reference, never a new project. */ }
    const source = { ...(project ? { projectName: project.name } : {}), ...(artifact.taskId && project?.tasks.some(task => task.id === artifact.taskId) ? { taskName: project.tasks.find(task => task.id === artifact.taskId)!.name } : {}) };
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
    let receipt = cases.reserveProjectCreation({ ...common, caseId, projectId, projectInput });
    let project: ProjectRecord | null = null;
    if (receipt.phase === 'prepared') {
      const selected = configuration.read(projectInput.configurationId);
      if (!selected?.hasApiKey) throw new CaseRouteError('configuration_required', 409);
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
    return { project: project ? await decorateProject(project) : null, operationId: common.operationId, projectId, linked: receipt.phase === 'completed', phase: receipt.phase,
      ...(receipt.phase === 'completed' && receipt.result?.case ? { case: receipt.result.case } : {}) };
  }
  return async function handle({ pathname, method, input = {} }: RouteRequest): Promise<RouteResult> {
    if (pathname === '/api/cases/storage' && method === 'GET') return { body: cases.getStatus() };
    if (pathname === '/api/cases/storage/initialize' && method === 'POST') return { body: await mutate(() => cases.initialize()) };
    if (pathname === '/api/cases') {
      if (method === 'GET') return { body: { cases: cases.listCases(), projectLinks: cases.listProjectLinks() } };
      if (method === 'POST') return { status: 201, body: await mutate(() => ({ case: cases.createCase({ operationId: string(input.operationId), title: string(input.title), description: optionalString(input.description) }) })) };
    }
    const operationMatch = /^\/api\/cases\/operations\/([a-f0-9-]+)$/.exec(pathname);
    if (operationMatch && method === 'GET') return { body: { operation: cases.getOperation(operationMatch[1]!) } };
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
    if (!action && method === 'GET') {
      const record = cases.getCase(caseId), projectLinks = cases.listProjectLinks(caseId), linked = new Set(projectLinks.map(link => link.projectId));
      return { body: { case: record, projectLinks, artifacts: await Promise.all(cases.getArtifacts(caseId, { includeUnlinked: true }).map(artifact => artifactView(artifact, linked))), pendingOperations: cases.listPendingProjectOperations(caseId), events: cases.getEvents('case', caseId), projectEvents: projectLinks.flatMap(link => cases.getEvents('project', link.projectId)) } };
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
      return cases.linkProject({ ...mutation(input), caseId, projectId, recoveryOf: optionalString(input.recoveryOfOperationId) });
    }) };
    if (action === 'projects/create' && method === 'POST') return { status: 201, body: await mutate(() => createProjectAndLink(caseId, input)) };
    const projectMatch = /^projects\/([a-f0-9-]+)$/.exec(action ?? '');
    if (projectMatch && method === 'DELETE') return { body: await mutate(() => cases.unlinkProject({ ...mutation(input), caseId, projectId: projectMatch[1]! })) };
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
        if (taskId && !project.tasks.some(task => task.id === taskId)) throw new CaseRouteError('task_not_found', 404);
        observation = await projects.observeFile(projectId, relativePath);
        uploadId = project.uploads.find(upload => upload.path === relativePath)?.id ?? null;
      }
      return cases.saveArtifact({ ...common, caseId, projectId, relativePath, taskId, uploadId,
        role: (input.role ?? 'file') as CaseArtifactRecord['role'], displayName: nullableString(input.displayName), observedSha256: observation.sha256, observedBytes: observation.bytes, observedAt: observation.observedAt });
    }) };
    const artifactMatch = /^artifacts\/([a-f0-9-]+)$/.exec(action ?? '');
    if (artifactMatch && method === 'DELETE') return { body: await mutate(() => cases.unlinkArtifact({ ...mutation(input), caseId, artifactId: artifactMatch[1]! })) };
    return null;
  };
}
