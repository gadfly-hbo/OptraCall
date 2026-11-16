import path from 'node:path';
import { createHash } from 'node:crypto';
import { projectSkillCatalog } from '../agent/skill-catalog.ts';
import type { ProjectStore, ProjectRecord } from './project-store.ts';
import type { CaseStore } from './case-store.ts';
import type { StrategyGoalsStore } from './strategy-goals-store.ts';
import { createProjectPlanStore, parseProjectPlanContent, ProjectPlanFault } from './project-plan-store.ts';
import type { ProjectPlanContent, ProjectPlanConfirmation, ProjectPlanDraftInput, ProjectPlanConfirmInput, ProjectPlanTask } from './project-plan-types.ts';
import type { SapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import type { GoalVersion } from './strategy-goals-types.ts';
import type { DbLinkPlanningSource } from './db-link-planning.ts';

export interface ProjectPlanDelivery {
  projectId: string; taskId: string; confirmationId: string; planVersion: number; taskKey: string; summaryTaskId: string;
  methods: ProjectPlanTask['capabilities']; text: string;
}
type Options = {
  codeRoot: string; resourceRoot: string; plans: ReturnType<typeof createProjectPlanStore>; projects: ProjectStore; cases: CaseStore; goals: StrategyGoalsStore; methods: SapMethodStore;
  mutate<T>(run: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
  startMessage(projectId: string, taskId: string, input: Record<string, unknown>): Promise<{ requestId: string; status: unknown; deduplicated?: boolean }>;
  registerFresh(projectId: string, taskId: string): Promise<void>;
  databaseSources?(projectId: string, options?: { taskId?: string; modelOutlet?: string }): Promise<DbLinkPlanningSource[]>;
};
function fail(code: string, status = 409): never { throw new ProjectPlanFault(code, status); }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function createProjectPlanFeature(options: Options) {
  const { plans, projects, cases, goals } = options;
  const writable = async (projectId: string) => { if (options.isClosing()) fail('host_closing'); const project = await projects.get(projectId); if (project.archivedAt) fail('project_archived'); return project; };
  const skillsFor = (project: ProjectRecord) => projectSkillCatalog(options.codeRoot, path.join(project.rootPath, '020_clean'), options.resourceRoot);
  async function goalContent(projectId: string, plan: Pick<ProjectPlanContent, 'goalContext' | 'caseContext'>): Promise<GoalVersion[]> {
    await projects.get(projectId);
    const refs = [plan.goalContext?.goal, plan.caseContext?.primaryGoal, ...(plan.caseContext?.relatedGoals || [])].filter(ref => ref !== undefined);
    const seen = new Set<string>();
    return refs.filter(ref => { const key = `${ref.goalId}:${ref.version}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(ref => {
      // Read the immutable selected version from its original authority. Never resolve latest.
      const exact = goals.read(ref);
      if (exact.status !== 'adopted') fail('project_plan_context_changed');
      return structuredClone(exact);
    });
  }
  async function validateTask(projectId: string, task: ProjectPlanTask, allowKnownMethodIssue = false) {
    const project = await writable(projectId), skills = skillsFor(project).skills;
      if (task.taskId) { const original = await projects.getTask(projectId, task.taskId); if (original.archivedAt) fail('project_plan_task_unavailable'); }
      for (const capability of task.capabilities) {
        if (capability.kind === 'skill') {
          const skill = skills.find(skill => skill.id === capability.id);
          if (!skill || capability.version !== skill.version || capability.sha256 !== skill.sha256) fail('project_plan_capability_changed');
        } else if (capability.kind === 'sap-method') {
          const method = options.methods.getPublished(capability.id, Number(capability.version));
          if (method.issue?.status === 'confirmed' && !allowKnownMethodIssue) fail('project_plan_method_unavailable');
        } else {
          if (capability.id.startsWith('db-link:')) {
            const sources = await options.databaseSources?.(projectId, task.taskId ? { taskId: task.taskId } : {});
            const source = sources?.find(source => source.id === capability.id && source.enabled && source.version === capability.version && source.sha256 === capability.sha256 && source.permissionRef === capability.permissionRef);
            if (!source) fail('project_plan_connector_permission_required');
            continue;
          }
          // Selection carries only already enabled Task permissions, never connector credentials.
          const original = task.taskId ? await projects.getTask(projectId, task.taskId) : undefined;
          const flag = capability.id === 'weather-mcp' ? 'weatherTools' : capability.id === 'trade-area-mcp' ? 'tradeAreaTools' : undefined;
          const match = /^task:([a-f0-9-]{36}):(weatherTools|tradeAreaTools)$/.exec(capability.permissionRef || '');
          const inherited = match && match[2] === flag ? project.tasks.find(task => task.id === match[1] && !task.archivedAt) : undefined;
          if (!flag || !(original?.[flag] || inherited?.[flag])) fail('project_plan_connector_permission_required');
        }
      }
  }
  async function capabilityIssues(projectId: string, plan: ProjectPlanContent) {
    await projects.get(projectId);
    return plan.tasks.flatMap(task => task.capabilities.flatMap(capability => {
      if (capability.kind !== 'sap-method') return [];
      const method = options.methods.getPublished(capability.id, Number(capability.version));
      return method.issue?.status === 'confirmed' ? [{ taskKey: task.key, capability: structuredClone(capability), code: 'project_plan_method_unavailable', reason: '此准确方法版本已确认存在错误，禁止采用；可解释影响、补证、建议暂缓或替代，并继续独立可行任务。核心方法替换须由用户集中确认，不静默换版。', issue: structuredClone(method.issue) }] : [];
    }));
  }
  async function validate(projectId: string, plan: ProjectPlanContent) {
    await writable(projectId);
    for (const task of plan.tasks.filter(task => task.selected || task.key === plan.summaryTaskKey)) await validateTask(projectId, task, true);
    for (const material of plan.materials.filter(ref => ref.kind === 'connector' && ref.id.startsWith('db-link:'))) {
      const sources = await options.databaseSources?.(projectId);
      if (!sources?.some(source => source.id === material.id && source.enabled && source.version === material.version && source.sha256 === material.sha256 && source.permissionRef === material.permissionRef)) fail('project_plan_connector_permission_required');
    }
    if (plan.goalContext) {
      if (goals.read(plan.goalContext.goal).status !== 'adopted') fail('project_plan_context_changed');
      if (plan.goalContext.purpose === 'case-investigation' && !plan.caseContext) fail('project_plan_case_required');
      if (plan.caseContext && ![plan.caseContext.primaryGoal, ...(plan.caseContext.relatedGoals || [])].some(ref => equal(ref, plan.goalContext!.goal))) fail('project_plan_context_changed');
    }
    if (plan.caseContext) {
      const context = plan.caseContext, record = cases.getCase(context.caseId), binding = cases.getGoalBinding(record.id);
      if (record.status === 'closed' || !binding || !equal(binding.primary, context.primaryGoal) || !equal(binding.related, context.relatedGoals || []) || context.caseRevision !== undefined && context.caseRevision !== record.revision || context.projectWorkRevision !== undefined && context.projectWorkRevision !== cases.getProjectWork(projectId).revision || !cases.listProjectLinks(record.id).some(link => link.projectId === projectId)) fail('project_plan_context_changed');
      for (const ref of [context.primaryGoal, ...(context.relatedGoals || [])]) if (goals.read(ref).status !== 'adopted') fail('project_plan_context_changed');
    }
  }
  async function capabilities(projectId: string, read: { modelOutlet?: string } = {}) {
    const project = await projects.get(projectId), skills = skillsFor(project);
    const caseContexts = cases.getStatus().state === 'ready' ? cases.listProjectLinks().filter(link => link.projectId === projectId).flatMap(link => {
      const record = cases.getCase(link.caseId), binding = cases.getGoalBinding(record.id);
      return record.status !== 'closed' && binding ? [{ caseId: record.id, title: record.title, primaryGoal: binding.primary, relatedGoals: binding.related, caseRevision: record.revision, projectWorkRevision: cases.getProjectWork(projectId).revision }] : [];
    }) : [];
    const tree = await projects.tree(projectId);
    const files: { kind: 'project-file'; id: string; title: string; sha256?: string }[] = [];
    const visit = (nodes: typeof tree) => { for (const node of nodes) { if (node.kind === 'directory') { if (!node.path.startsWith('010_draw')) visit(node.children || []); } else files.push({ kind: 'project-file', id: node.path, title: node.name, ...(project.uploads.find(upload => upload.path === node.path)?.sha256 ? { sha256: project.uploads.find(upload => upload.path === node.path)!.sha256 } : {}) }); } };
    visit(tree);
    const databaseSources = options.databaseSources ? (await Promise.all([options.databaseSources(projectId, read), ...project.tasks.filter(task => !task.archivedAt).map(task => options.databaseSources!(projectId, { ...read, taskId: task.id }))])).flat() : [];
    return { skills: skills.skills.map(({ id, title, version, sha256 }) => ({ id, title, version, sha256 })), methods: options.methods.listPublished().map(method => ({ id: method.id, title: method.title, version: String(method.publishedVersion) })), connectors: [...([['weather-mcp', '天气连接器', 'weatherTools'], ['trade-area-mcp', '商圈连接器', 'tradeAreaTools']] as const).map(([id, title, flag]) => { const source = project.tasks.find(task => task[flag] && !task.archivedAt); return { id, title, enabled: Boolean(source), requiresPermission: true as const, ...(source ? { permissionRef: `task:${source.id}:${flag}` } : {}) }; }), ...databaseSources.map(({ id, title, version, sha256, permissionRef, enabled, taskId }) => ({ id, title, version, sha256, permissionRef, enabled, requiresPermission: true as const, ...(taskId ? { taskId } : {}) }))], materials: [...files, ...databaseSources.filter(source => !source.taskId).map(({ id, title, version, sha256, permissionRef, enabled }) => ({ kind: 'connector' as const, id, title, version, sha256, permissionRef, enabled }))], databaseSources, caseContexts, diagnostics: skills.diagnostics };
  }
  async function context(projectId: string, taskId: string, selection: unknown): Promise<ProjectPlanDelivery | undefined> {
    if (selection === undefined) return undefined;
    if (!selection || typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).some(key => !['confirmationId', 'taskKey'].includes(key))) fail('invalid_project_plan_context', 400);
    const selected = selection as { confirmationId?: string; taskKey?: string }, state = await plans.read(projectId);
    const confirmation = state.history.find(item => item.id === selected.confirmationId), receipt = confirmation?.tasks.find(item => item.taskKey === selected.taskKey && item.taskId === taskId);
    if (!confirmation || !receipt || !['created', 'not-required'].includes(receipt.createStatus)) fail('project_plan_context_changed');
    const task = confirmation.plan.tasks.find(item => item.key === receipt.taskKey)!;
    const summary = confirmation.tasks.find(item => item.taskKey === confirmation.plan.summaryTaskKey)!;
    const content = { projectId, confirmationId: confirmation.id, planVersion: confirmation.planVersion, request: confirmation.plan.request, goalContext: confirmation.plan.goalContext, goalContent: await goalContent(projectId, confirmation.plan), premises: confirmation.plan.premises, materials: confirmation.plan.materials, caseContext: confirmation.plan.caseContext, coverage: confirmation.plan.coverage, tasks: confirmation.tasks.map(item => ({ taskId: item.taskId, key: item.taskKey, scope: confirmation.plan.tasks.find(task => task.key === item.taskKey)!.scope, createStatus: item.createStatus, startStatus: item.startStatus })), currentTask: { id: taskId, key: task.key, scope: task.scope, capabilities: task.capabilities }, summaryTaskId: summary.taskId, dependencies: confirmation.plan.dependencies };
    const skillMetadata = skillsFor(await projects.get(projectId)).skills;
    const selectedSkills = task.capabilities.filter(item => item.kind === 'skill').map(item => { const skill = skillMetadata.find(skill => skill.id === item.id && skill.sha256 === item.sha256); if (!skill) return fail('project_plan_capability_changed'); return { id: skill.id, path: skill.filePath, sha256: skill.sha256 }; });
    const text = `【已确认的项目约定与本任务责任】\n项目整体采用TOC/TP作为系统改善框架。具体树、工具、分析顺序及协作由你自主安排，可组合其他专业方法。实质使用本任务已选Skill/IR；先读取其准确指引并核适用性，不以目录可见代替采用。资料不足主动补证，说明具体缺口，继续有独立依据的部分；不伪造前提、根因或效果。\n综合责任由明确项目内Task承接，需核准确子成果、分歧、交叉影响和遗漏；下列依赖是已确认的业务关系，不是Host固定分析步骤。尚未取得的成果保留待核，不编造其他Task已完成。\n${JSON.stringify(content)}\n所选Skill准确入口：${JSON.stringify(selectedSkills)}`;
    return { projectId, taskId, confirmationId: confirmation.id, planVersion: confirmation.planVersion, taskKey: task.key, summaryTaskId: summary.taskId, methods: task.capabilities, text };
  }
  async function handle(projectId: string, action: string, method: string, input: Record<string, unknown> = {}) {
    if (action === 'plan' && method === 'GET') { await projects.get(projectId); return { body: await plans.read(projectId) }; }
    if (action === 'plan/capabilities' && method === 'GET') return { body: await capabilities(projectId) };
    if (action === 'plan/draft' && method === 'POST') {
      const plan = parseProjectPlanContent(input.plan); await validate(projectId, plan);
      return { body: await options.mutate(() => plans.saveDraft(projectId, input as unknown as ProjectPlanDraftInput)) };
    }
    if (action === 'plan/confirm' && method === 'POST') {
      await writable(projectId);
      return { body: await plans.confirm(projectId, input as unknown as ProjectPlanConfirmInput, {
        readTask: (projectId, taskId) => projects.getTask(projectId, taskId), validate,
        createTask: async operation => options.mutate(async () => {
          try { await validateTask(projectId, operation.task); }
          catch (error) { if (error instanceof ProjectPlanFault) return { status: 'failed' as const, code: error.code }; throw error; }
          const project = await writable(projectId);
          const task = await projects.createTaskWithPlan(projectId, { taskId: operation.taskId, name: operation.task.name, planOrigin: operation.origin, configuration: project.configuration, ...(operation.task.capabilities.some(ref => ref.kind === 'connector' && ref.id === 'weather-mcp') ? { weatherTools: true } : {}), ...(operation.task.capabilities.some(ref => ref.kind === 'connector' && ref.id === 'trade-area-mcp') ? { tradeAreaTools: true } : {}) });
          await options.registerFresh(projectId, task.id); return { taskId: task.id };
        }),
        startTask: async operation => {
          try {
            await writable(projectId);
            await validateTask(projectId, { ...operation.task, taskId: operation.taskId });
            const result = await options.startMessage(projectId, operation.taskId, { requestId: operation.requestId, text: operation.task.scope || operation.confirmation.plan.request, projectPlan: { confirmationId: operation.confirmation.id, taskKey: operation.task.key }, ...(operation.confirmation.plan.caseContext ? { caseContext: { caseId: operation.confirmation.plan.caseContext.caseId, caseRevision: operation.confirmation.plan.caseContext.caseRevision, projectWorkRevision: operation.confirmation.plan.caseContext.projectWorkRevision, selectedReferenceIds: [] } } : {}) });
            return { status: 'accepted' as const, ...(result.deduplicated ? { code: 'existing_request' } : {}) };
          } catch (error) { const fault = error as { code?: string; status?: number }; return { status: fault.status && fault.status < 500 ? 'failed' as const : 'unknown' as const, code: fault.code || 'project_plan_start_unknown' }; }
        },
      }) };
    }
    return null;
  }
  return { handle, context, capabilities, validate, goalContent, capabilityIssues };
}
