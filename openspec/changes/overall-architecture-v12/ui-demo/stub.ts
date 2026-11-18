/** Browser-only synthetic transport for the review Demo. No Host, Pi, provider or disk data. */
import type { GoalDraftInput, GoalRef, GoalVersion, StrategyGoalRecord, StrategyGoalsIndex } from '../../../../src/host/strategy-goals-types.ts';
import type { ClientProject, ClientTask, PublicModelConfiguration, SessionSnapshot } from '../../../../src/host/ui/project-types.ts';
import type { CaseRecord, CaseGoalBinding, CaseDetail, OperationReceipt, CaseProjectLink } from '../../../../src/host/case-types.ts';
import type { ProjectPlanContent, ProjectPlanState, ProjectPlanConfirmation } from '../../../../src/host/project-plan-types.ts';

type Data = Record<string, any>;
export type DemoWorkContext = { goal?: GoalRef; sourceGoal?: GoalRef; purpose?: { kind: string; background: string }; discussionId?: string; mode?: string; planVersion?: number; confirmationId?: string };
export const ids = {
  enterprise: '10000000-0000-4000-8000-000000000001',
  goal: '20000000-0000-4000-8000-000000000001',
  departmentGoal: '20000000-0000-4000-8000-000000000002',
  personalGoal: '20000000-0000-4000-8000-000000000003',
  project: '30000000-0000-4000-8000-000000000001',
  task: '40000000-0000-4000-8000-000000000001',
  case: '50000000-0000-4000-8000-000000000001',
  caseStore: '60000000-0000-4000-8000-000000000001',
} as const;
export type DemoScenario = 'bsc-history' | 'no-bsc' | 'department' | 'personal';
export function getDemoScenario(): DemoScenario {
  const scenario = new URL(window.location.href).searchParams.get('scenario');
  return scenario === 'no-bsc' || scenario === 'department' || scenario === 'personal' ? scenario : 'bsc-history';
}
const clone = <T>(value: T): T => structuredClone(value);
const timestamp = '2026-11-17T08:00:00.000Z';
const now = () => new Date().toISOString();
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const demoConfiguration: PublicModelConfiguration = { id: 'synthetic-demo', name: '交互演示 · 合成回复', provider: 'synthetic-demo', api: 'openai-completions', baseUrl: 'https://synthetic.invalid', model: 'no-model', revision: 1, hasApiKey: true };
const configuration = (() => { const { hasApiKey: _unused, ...value } = demoConfiguration; return value; })();
function version(goalId: string, input: Partial<GoalVersion> = {}): GoalVersion {
  return {
    goalId, version: 1, status: 'adopted', createdAt: timestamp, adoptedAt: timestamp, adoptionDecision: '合成场景中已明确采用该目标；经营动作和效果另行核对。',
    title: '改善会员持续购买的经营贡献', outcome: '先核对服饰会员持续购买受阻的主要情境，形成可比较、有依据的改善选择。',
    perspective: 'profit', scope: { kind: 'enterprise', id: ids.enterprise, name: '云杉服饰（合成）' },
    measurement: { kind: 'deliverable', criterion: '交付可核对的会员分群、关键尺码可得性与成本取舍说明，明确未知及观察方案。' },
    baseline: { state: 'pending', description: '待核对可比期间、会员分群及退货口径；没有用合成数字冒充经营基线。' },
    responsible: '经营团队（合成场景中已明确）', strategies: ['先核对关键尺码可得性与会员购买受阻情境，再比较补货、商品组合和触达选择。'],
    resources: ['沿原项目授权使用合成资料；未授权真实采购、促销或客户触达。'], necessaryConditions: ['群体、观察期间与口径可比；库存变化及产品吸引力仍需补证。'],
    bscPerspective: '客户与服务对象', source: { authority: 'task', id: ids.task, version: 1, projectId: ids.project, taskId: ids.task }, ...input,
  };
}
function initialGoals(): StrategyGoalsIndex {
  const first = version(ids.goal), next = version(ids.goal, { version: 2, status: 'candidate', adoptedAt: undefined, adoptionDecision: undefined, createdAt: '2026-11-17T08:15:00.000Z', title: '改善会员持续购买，同时核对库存资金取舍', outcome: '候选修订：比较关键尺码可得性、持续购买与库存资金之间的取舍，先补可比资料。' });
  const department = version(ids.departmentGoal, { title: '明确会员业务模块的改善重点', outcome: '在已知职责范围内，形成会员服务与购买受阻问题的改善选择；上层战略尚未知。', scope: { kind: 'department', id: 'member-service', name: '会员业务模块（上层组织未知）' }, responsible: '会员业务负责人（合成场景已明确）', bscPerspective: undefined, strategies: ['核对本职责范围的服务对象、主要受阻情境和可独立推进的改善。'], necessaryConditions: ['上层战略未知，不推定已获得企业资料或SAP指标权限。'] });
  const personal = version(ids.personalGoal, { title: '兼顾事业发展与家庭时间', outcome: '明确本人愿意投入的事业方向与家庭时间边界，形成可讨论的取舍。', baseline: { state: 'pending', description: '本人的可支配时间、工作负荷与家庭安排待核对；未据此宣称已形成有效安排。' }, perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人事业与家庭（合成）' }, responsible: '本人（合成场景已明确）', bscPerspective: undefined, strategies: ['比较职业学习投入、当前工作责任和家庭陪伴的替代安排。'], resources: ['每周可支配时间待本人进一步补充。'], necessaryConditions: ['家人安排和事业机会均待核对，不套用企业财务目标。'], measurement: { kind: 'deliverable', criterion: '形成本人可核对的时间安排候选与取舍理由；尚未承诺具体时数或效果。' } });
  const records: StrategyGoalRecord[] = [
    { id: ids.goal, currentVersion: 2, adoptedVersion: 1, versions: [first, next] },
    { id: ids.departmentGoal, currentVersion: 1, adoptedVersion: 1, versions: [department] },
    { id: ids.personalGoal, currentVersion: 1, adoptedVersion: 1, versions: [personal] },
  ];
  const scenario = getDemoScenario();
  if (scenario === 'no-bsc') records.forEach(record => record.versions.forEach(item => { delete item.bscPerspective; }));
  // These scenarios have no enterprise grant. Do not leak an organization Goal through the synthetic directory.
  if (scenario === 'department' || scenario === 'personal') return { goals: records.filter(record => record.id === (scenario === 'department' ? ids.departmentGoal : ids.personalGoal)), relations: [], feedback: [], arrangements: [] };
  return {
    goals: records,
    relations: [{ id: '70000000-0000-4000-8000-000000000001', revision: 2, createdAt: timestamp, from: { goalId: ids.departmentGoal, version: 1 }, to: { goalId: ids.goal, version: 1 }, kind: 'contribution', responsibility: '会员业务提供职责内的受阻情境，不机械分摊企业指标。', rationale: '可能通过减少购买受阻贡献持续购买；产品吸引力和成本是待核前提，贡献并非已证因果。', history: [{ revision: 1, createdAt: timestamp, from: { goalId: ids.departmentGoal, version: 1 }, to: { goalId: ids.goal, version: 1 }, kind: 'supports', responsibility: '合成历史职责说明。', rationale: '合成历史依据保留。' }] }],
    feedback: (['execution', 'strategy', 'strategic-assumption'] as const).map((level, index) => ({ id: `80000000-0000-4000-8000-00000000000${index + 1}`, goal: { goalId: ids.goal, version: 1 }, level, source: { authority: 'task' as const, id: ids.task, version: 1, projectId: ids.project, taskId: ids.task }, note: ['执行反馈：本轮仅核对合成资料，没有发生经营动作。', '策略反馈：商品可得性与触达是不同选择，需比较成本和适用群体。', '战略假设反馈：购买受阻只是候选解释；季节、产品吸引力与观察窗口仍待核对。'][index]!, createdAt: timestamp })),
    arrangements: [],
  };
}
function defaultGoal(): GoalRef { const scenario = getDemoScenario(); return { goalId: scenario === 'department' ? ids.departmentGoal : scenario === 'personal' ? ids.personalGoal : ids.goal, version: 1 }; }
function defaultPurpose() { const kind = getDemoScenario() === 'department' ? 'department' : getDemoScenario() === 'personal' ? 'personal' : 'organization'; return { kind, background: kind === 'department' ? '会员业务模块；上层战略未知。' : kind === 'personal' ? '本人事业与家庭目标。' : '服饰零售组织；全部资料为合成。' }; }
function newTask(id: string, name: string): ClientTask { return { id, name, draft: '', configuration: clone(configuration), createdAt: timestamp, updatedAt: timestamp, sessionStorage: 'task', simulationTools: false, tradeAreaTools: false, weatherTools: false, modelTools: false }; }
const seededTask = newTask(ids.task, '会员复购与购买受阻核对（合成）');
const projects: ClientProject[] = [{ schemaVersion: 2, id: ids.project, name: '会员复购改善（合成）', configuration: clone(configuration), rootPath: '/synthetic-only/OptraCallProjects/member-retention', createdAt: timestamp, updatedAt: timestamp, archivedAt: null, tasks: [seededTask] }];
let goals = initialGoals();
const initialCase: CaseRecord = { id: ids.case, title: '会员复购下滑是否需要调整商品可得性（合成）', description: '保留目标 v1 的持续经营事项，尚未认定根因或经营效果。', judgement: '购买受阻是候选解释，仍需补证。', nextStep: '沿已确认项目核对资料与可比较选择。', status: 'pending', closeReason: null, closedAt: null, revision: 1, createdAt: timestamp, updatedAt: timestamp };
const cases: CaseRecord[] = [initialCase];
const bindings = new Map<string, CaseGoalBinding[]>([[ids.case, [{ caseId: ids.case, primary: defaultGoal(), related: [], caseRevision: 1, confirmedAt: timestamp, operationId: '90000000-0000-4000-8000-000000000001' }]]]);
const links: CaseProjectLink[] = [{ caseId: ids.case, projectId: ids.project, linkedAt: timestamp }];
const caseOperations = new Map<string, OperationReceipt>();
const goalOperations = new Map<string, Data>();
const goalOperationHashes = new Map<string, string>();
const plans = new Map<string, ProjectPlanState>();
const taskContexts = new Map<string, Data>();
const requestLog: Data[] = [];
let failure: 'none' | 'conflict' | 'unknown' = 'none';
let installed = false;
let workEntrance: DemoWorkContext | undefined;
let automatic = { formatVersion: 1, revision: 0, nodes: { save: false, review: false, ir: false, case: false, assets: false } };
export function setDemoFailure(mode: 'none' | 'conflict' | 'unknown'): void { failure = mode; }
/** Freeze the current explicit entrance. Global default changes never mutate this or existing work. */
export function rememberDemoWorkEntrance(context: DemoWorkContext): void { workEntrance = clone(context); }
export function rememberDemoTaskContext(projectId: string, taskId: string, context: Data): void { taskContexts.set(`${projectId}/${taskId}`, clone(context)); }
export function readTaskDemoContext(projectId: string, taskId: string): DemoWorkContext | undefined { return clone(taskContexts.get(`${projectId}/${taskId}`) ?? taskContexts.get(`${projectId}/*`)); }
rememberDemoTaskContext(ids.project, ids.task, { goal: defaultGoal(), purpose: defaultPurpose(), mode: 'create' });
export function getDemoSnapshot(): Data { return clone({ synthetic: true, scenario: getDemoScenario(), failure, goals, projects, cases, plans: Object.fromEntries(plans), goalOperations: Object.fromEntries(goalOperations), taskContexts: Object.fromEntries(taskContexts), workEntrance, requestLog }); }
function initialPlan(project: ClientProject): ProjectPlanContent {
  const task = project.tasks[0];
  const key = task?.id ?? 'new-task';
  return { request: project.name, premises: ['仅使用合成演示资料；不调用模型或业务连接器。'], materials: [], coverage: [], tasks: [{ key, name: task?.name ?? '本次分析', ...(task ? { taskId: task.id } : {}), selected: true, scope: '核对已明确目标的依据、未知及可行选择。', capabilities: [] }], taskMode: 'single', summaryTaskKey: key, dependencies: [], caseContext: null, ...(project.id === ids.project ? { goalContext: { goal: defaultGoal(), purpose: 'assigned-work' as const } } : {}) };
}
const seededPlan = initialPlan(projects[0]!);
const seededConfirmation: ProjectPlanConfirmation = { id: 'a0000000-0000-4000-8000-000000000001', projectId: ids.project, planVersion: 1, confirmedAt: timestamp, mode: 'create', authorizations: [], plan: clone(seededPlan), tasks: [{ taskKey: ids.task, taskId: ids.task, createRequestId: crypto.randomUUID(), startRequestId: crypto.randomUUID(), createStatus: 'not-required', startStatus: 'not-requested', observations: [] }] };
plans.set(ids.project, { formatVersion: 1, projectId: ids.project, revision: 1, draft: { version: 1, createdAt: timestamp, plan: seededPlan }, confirmed: seededConfirmation, history: [seededConfirmation], operations: [], preparations: [] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const error = (code: string, status = 400) => json({ code, message: code === 'demo_endpoint_not_implemented' ? '此入口不在本次交互演示范围；请求未发送到任何服务。' : undefined, synthetic: true }, status);
function findProject(id: string) { return projects.find(project => project.id === id); }
function findGoal(id: string) { return goals.goals.find(record => record.id === id); }
function caseDetail(record: CaseRecord): CaseDetail { return { case: record, goalBinding: bindings.get(record.id)?.at(-1) ?? null, projectLinks: links.filter(link => link.caseId === record.id), artifacts: [], events: [], projectEvents: [], pendingOperations: [] }; }
function snapshot(projectId: string, task: ClientTask): SessionSnapshot {
  const context = readTaskDemoContext(projectId, task.id);
  const text = `交互演示：本任务沿原项目确认入口创建。${context?.goal ? `继承目标 ${context.goal.goalId} · v${context.goal.version}。` : ''}此处展示合成上下文，没有调用 Pi、模型、工具或执行业务动作。`;
  return { sessionId: `synthetic-${task.id}`, messages: [{ role: 'custom', display: true, customType: 'demo-context', content: text }], tools: [], status: 'idle', sdkVersion: '1.4.0 · 未运行', capabilities: {} };
}
function eventResponse(projectId: string, task: ClientTask, signal?: AbortSignal | null) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    const send = (text: string) => { try { controller.enqueue(new TextEncoder().encode(text)); } catch { if (timer) clearInterval(timer); } };
    send(`data: ${JSON.stringify({ type: 'snapshot', projectId, taskId: task.id, snapshot: snapshot(projectId, task) })}\n\n`);
    timer = setInterval(() => send(': synthetic-heartbeat\n\n'), 15_000);
    signal?.addEventListener('abort', () => { if (timer) clearInterval(timer); try { controller.close(); } catch {} }, { once: true });
  }, cancel() { if (timer) clearInterval(timer); } });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}
async function saveGoal(pathname: string, input: Data): Promise<Response> {
  const requestHash = await digest([pathname, input]);
  const original = goalOperations.get(input.operationId);
  if (original) return goalOperationHashes.get(input.operationId) === requestHash ? json({ goal: original.result, replayed: true }) : error('strategy_goal_operation_conflict', 409);
  if (failure === 'conflict') { failure = 'none'; return error('strategy_goal_conflict', 409); }
  const mode = failure; failure = 'none';
  const match = /^\/api\/strategy\/goals\/([^/]+)\/(adopt|revisions)$/.exec(pathname);
  const kind = match?.[2] === 'adopt' ? 'adopt' : match?.[2] === 'revisions' ? 'revise' : 'create';
  let result: GoalVersion;
  if (kind === 'create') {
    if (!input.title?.trim() || !input.outcome?.trim() || !input.responsible?.trim() || !input.scope?.id || !input.measurement || !input.baseline) return error('invalid_strategy_goal');
    const { operationId: _unused, expectedVersion: _expected, ...fields } = input;
    const id = crypto.randomUUID(); result = { ...clone(fields as GoalDraftInput), goalId: id, version: 1, status: 'candidate', createdAt: now() };
    goals.goals.push({ id, currentVersion: 1, adoptedVersion: null, versions: [result] });
  } else {
    const record = findGoal(match![1]!); if (!record) return error('strategy_goal_not_found', 404);
    if (input.expectedVersion !== record.currentVersion) return error('strategy_goal_conflict', 409);
    if (kind === 'revise') {
      if (!input.title?.trim() || !input.outcome?.trim() || !input.responsible?.trim()) return error('invalid_strategy_goal');
      const { operationId: _unused, expectedVersion: _expected, ...fields } = input;
      result = { ...clone(fields as GoalDraftInput), goalId: record.id, version: record.currentVersion + 1, status: 'candidate', createdAt: now() };
      record.currentVersion = result.version; record.versions.push(result);
    } else {
      const target = record.versions.find(value => value.version === input.version); if (!target) return error('strategy_goal_not_found', 404);
      if (!input.decision?.trim()) return error('invalid_strategy_goal');
      target.status = 'adopted'; target.adoptedAt = now(); target.adoptionDecision = input.decision; record.adoptedVersion = target.version; result = target;
    }
  }
  goalOperationHashes.set(input.operationId, requestHash);
  goalOperations.set(input.operationId, { operationId: input.operationId, requestHash, kind, completedAt: now(), result: clone(result) });
  return mode === 'unknown' ? error('strategy_goals_write_unknown', 503) : json({ goal: result }, kind === 'adopt' ? 200 : 201);
}
async function projectPlan(project: ClientProject, suffix: string, method: string, input: Data): Promise<Response> {
  let state = plans.get(project.id); if (!state) { state = { formatVersion: 1, projectId: project.id, revision: 0, history: [], operations: [], preparations: [] }; plans.set(project.id, state); }
  if (!suffix && method === 'GET') return json(state);
  if (suffix === '/capabilities' && method === 'GET') return json({ skills: [], methods: [], connectors: [], materials: [], caseContexts: links.filter(link => link.projectId === project.id).flatMap(link => { const record = cases.find(item => item.id === link.caseId), binding = bindings.get(link.caseId)?.at(-1); return record && binding ? [{ caseId: record.id, title: record.title, primaryGoal: binding.primary, relatedGoals: binding.related, caseRevision: record.revision, projectWorkRevision: project.work?.revision ?? 0 }] : []; }) });
  if (method !== 'POST') return error('demo_endpoint_not_implemented', 503);
  const oldOperation = state.operations?.find(operation => operation.operationId === input.operationId);
  if (oldOperation) {
    if (oldOperation.requestHash !== await digest(input)) return error('project_plan_operation_conflict', 409);
    if (suffix === '/confirm') return json({ state, confirmation: state.history.find(item => item.id === oldOperation.confirmationId), replayed: true });
    return json({ state, draft: state.draft, preparation: state.preparations?.find(item => item.operationId === input.operationId), replayed: true });
  }
  if (input.expectedRevision !== state.revision) return error('project_plan_conflict', 409);
  if (suffix === '/draft' || suffix === '/prepare') {
    const plan = clone(input.plan as ProjectPlanContent);
    if (suffix === '/prepare') {
      plan.premises = [...plan.premises, '合成轻量梳理：没有读取经营数据；目标与来源版本保持。'];
      plan.coverage = [{ key: 'coverage-evidence', label: '范围、依据与可行选择', disposition: 'focus', reason: '先核对已明确诉求及未知，不在准备阶段试算或归因。', taskKeys: [plan.summaryTaskKey] }];
      plan.tasks = plan.tasks.map(task => ({ ...task, scope: task.scope || '核对现有依据、关键未知与可比较的独立可行选择。' }));
    }
    const draft = { version: (state.draft?.version ?? 0) + 1, createdAt: now(), plan }; state.revision++; state.draft = draft;
    state.operations!.push({ operationId: input.operationId, kind: suffix === '/prepare' ? 'prepare' : 'draft', planVersion: draft.version, requestHash: await digest(input) });
    if (suffix === '/prepare') {
      const preparation = { operationId: input.operationId, inputHash: await digest(input), status: 'completed' as const, draftVersion: draft.version, mece: { sameLevel: '按本次问题范围组织。', coverage: '已覆盖依据和未知，未读取明细。', boundaries: '不越权展开战略尽调。', depth: '深度由实际问题决定。' }, limitations: ['这是固定合成回复，没有运行需求 Agent。'] };
      state.preparations!.push(preparation); return json({ state, draft, preparation, replayed: false });
    }
    return json({ state, draft, replayed: false });
  }
  if (suffix === '/confirm') {
    if (!state.draft) return error('invalid_project_plan');
    const plan = clone(state.draft.plan), id = crypto.randomUUID(), requestHash = await digest(input);
    const confirmation: ProjectPlanConfirmation = { id, projectId: project.id, planVersion: state.draft.version, confirmedAt: now(), mode: input.mode, authorizations: [{ operationId: input.operationId, mode: input.mode, authorizedAt: now() }], plan, tasks: [] };
    for (const entry of plan.tasks.filter(task => task.selected)) {
      let task = entry.taskId ? project.tasks.find(value => value.id === entry.taskId) : undefined;
      const existed = !!task;
      if (!task) { task = newTask(crypto.randomUUID(), entry.name); task.planOrigin = { confirmationId: id, taskKey: entry.key, requestHash }; project.tasks.push(task); }
      confirmation.tasks.push({ taskKey: entry.key, taskId: task.id, createRequestId: crypto.randomUUID(), startRequestId: crypto.randomUUID(), createStatus: existed ? 'not-required' : 'created', startStatus: input.mode === 'start' ? 'accepted' : 'not-requested', observations: [] });
      const previous = readTaskDemoContext(project.id, task.id) ?? { purpose: defaultPurpose() };
      rememberDemoTaskContext(project.id, task.id, { ...previous, ...(plan.goalContext ? { goal: plan.goalContext.goal } : {}), mode: input.mode, planVersion: state.draft.version, confirmationId: id });
    }
    state.revision++; state.confirmed = confirmation; state.history.push(confirmation); state.operations!.push({ operationId: input.operationId, kind: 'confirm', planVersion: state.draft.version, confirmationId: id, requestHash });
    return json({ state, confirmation, replayed: false });
  }
  return error('demo_endpoint_not_implemented', 503);
}
async function route(url: URL, method: string, input: Data, signal?: AbortSignal | null): Promise<Response> {
  const pathname = url.pathname;
  if (pathname === '/api/configurations' && method === 'GET') return json({ configurations: [demoConfiguration], selectedId: demoConfiguration.id });
  if (pathname === '/api/projects') {
    if (method === 'GET') return json({ projects });
    if (method === 'POST') { const project: ClientProject = { schemaVersion: 2, id: crypto.randomUUID(), name: input.name, configuration: clone(configuration), rootPath: '/synthetic-only/OptraCallProjects/new-project', createdAt: now(), updatedAt: now(), archivedAt: null, tasks: [] }; projects.push(project); if (workEntrance) { rememberDemoTaskContext(project.id, '*', workEntrance); workEntrance = undefined; } return json({ project }, 201); }
  }
  if (pathname === '/api/strategy/goals') return method === 'GET' ? json(goals) : method === 'POST' ? saveGoal(pathname, input) : error('demo_endpoint_not_implemented', 503);
  if (/^\/api\/strategy\/goals\/[^/]+\/(adopt|revisions)$/.test(pathname) && method === 'POST') return saveGoal(pathname, input);
  const goalRead = /^\/api\/strategy\/goals\/([^/]+)$/.exec(pathname);
  if (goalRead && method === 'GET') return findGoal(goalRead[1]!) ? json({ goal: findGoal(goalRead[1]!) }) : error('strategy_goal_not_found', 404);
  const goalOperation = /^\/api\/strategy\/operations\/([^/]+)$/.exec(pathname);
  if (goalOperation && method === 'GET') return json({ operation: goalOperations.get(goalOperation[1]!) ?? null });
  if (pathname === '/api/strategy/sources' && method === 'GET') return json({ sources: [{ label: '合成项目任务 · 版本1', ref: { authority: 'task', id: ids.task, version: 1, projectId: ids.project, taskId: ids.task } }, { label: '原合成Case · 修订1', ref: { authority: 'case', id: ids.case, version: 1 } }], unavailable: [] });
  if (pathname === '/api/strategy/feedback' && method === 'POST') { const value = { ...input, id: crypto.randomUUID(), createdAt: now() }; goals.feedback.push(value as any); return json({ feedback: value }, 201); }
  if (pathname === '/api/strategy/relations' && method === 'POST') { const value = { ...input, id: crypto.randomUUID(), revision: 1, history: [], createdAt: now() }; goals.relations.push(value as any); return json({ relation: value }, 201); }
  const relation = /^\/api\/strategy\/relations\/([^/]+)\/revisions$/.exec(pathname);
  if (relation && method === 'POST') { const value = goals.relations.find(item => item.id === relation[1]); if (!value) return error('strategy_goal_not_found', 404); if (value.revision !== input.expectedRevision) return error('strategy_goal_relation_conflict', 409); value.history.push(clone(value)); Object.assign(value, input, { revision: value.revision + 1, createdAt: now() }); return json({ relation: value }); }
  if (pathname === '/api/studio/enterprises' && method === 'GET') return json({ enterprises: getDemoScenario() === 'department' || getDemoScenario() === 'personal' ? [] : [{ id: ids.enterprise, name: '云杉服饰（合成）', revision: 1, createdAt: timestamp }], projectAssignments: [], caseAssignments: [], assetAssignments: [] });
  if (pathname === '/api/studio/systems' && method === 'GET') return json({ systems: [] });
  if (pathname === '/api/studio/foundation' && method === 'GET') return json({ enterprise: { id: ids.enterprise, name: '云杉服饰（合成）', revision: 1, createdAt: timestamp }, systems: [], items: [], unassigned: [] });
  if (pathname === '/api/metric-factory/library' && method === 'GET') return json({ entries: [] });
  if (pathname === '/api/enterprise-materials' && method === 'GET') return json({ storeId: ids.caseStore, materials: [] });
  if (pathname === '/api/decision-board' && method === 'GET') return json({ projects: projects.map(project => ({ id: project.id, name: project.name, archived: !!project.archivedAt, reports: [] })), reports: [], items: [], extractions: [] });
  if (pathname === '/api/cases/storage' || pathname === '/api/cases/storage/initialize') return json({ state: 'ready', storeId: ids.caseStore });
  if (pathname === '/api/cases') {
    if (method === 'GET') return json({ cases, projectLinks: links });
    if (method === 'POST') {
      const old = caseOperations.get(input.operationId); if (old) return json(old.result);
      if (!input.goalBinding?.primary || findGoal(input.goalBinding.primary.goalId)?.versions.find(item => item.version === input.goalBinding.primary.version)?.status !== 'adopted') return error('case_primary_goal_required', 409);
      const record: CaseRecord = { id: crypto.randomUUID(), title: input.title, description: input.description ?? '', judgement: '', nextStep: '', status: 'pending', closeReason: null, closedAt: null, revision: 1, createdAt: now(), updatedAt: now() }; cases.push(record);
      bindings.set(record.id, [{ ...clone(input.goalBinding), caseId: record.id, caseRevision: 1, confirmedAt: now(), operationId: input.operationId }]);
      caseOperations.set(input.operationId, { operationId: input.operationId, kind: 'create-case', requestSha256: await digest(input), caseId: record.id, projectId: null, phase: 'completed', result: { case: record }, createdAt: now(), updatedAt: now() });
      return json({ case: record }, 201);
    }
  }
  const caseOperation = /^\/api\/cases\/operations\/([^/]+)$/.exec(pathname); if (caseOperation && method === 'GET') return json({ operation: caseOperations.get(caseOperation[1]!) ?? null });
  const caseRoute = /^\/api\/cases\/([^/]+)(.*)$/.exec(pathname);
  if (caseRoute) {
    const record = cases.find(item => item.id === caseRoute[1]); if (!record) return error('case_not_found', 404);
    const suffix = caseRoute[2]!;
    if (!suffix && method === 'GET') return json(caseDetail(record));
    if (suffix === '/goals' && method === 'GET') return json({ goalBinding: bindings.get(record.id)?.at(-1) ?? null, history: bindings.get(record.id) ?? [] });
    if (suffix === '/goals' && method === 'POST') { if (record.revision !== input.expectedRevision) return error('revision_conflict', 409); record.revision++; const binding = { ...clone(input.goalBinding), caseId: record.id, caseRevision: record.revision, confirmedAt: now(), operationId: input.operationId }; bindings.set(record.id, [...(bindings.get(record.id) ?? []), binding]); return json({ goalBinding: binding }); }
    if (suffix === '/projects' && method === 'POST') { const old = caseOperations.get(input.operationId); if (old) return json(old.result); if (record.revision !== input.expectedRevision) return error('revision_conflict', 409); if (!findProject(input.projectId)) return error('project_not_found', 404); if (!links.some(link => link.caseId === record.id && link.projectId === input.projectId)) links.push({ caseId: record.id, projectId: input.projectId, linkedAt: now() }); record.revision++; record.updatedAt = now(); const result = { case: record }; caseOperations.set(input.operationId, { operationId: input.operationId, kind: 'link-project', requestSha256: await digest(input), caseId: record.id, projectId: input.projectId, phase: 'completed', result, createdAt: now(), updatedAt: now() }); return json(result); }
    if (suffix === '/enterprise-materials' && method === 'GET') return json({ caseId: record.id, caseRevision: record.revision, selections: [], materials: [], unavailable: [] });
    if (suffix === '/decisions' && method === 'GET') return json({ caseStoreId: ids.caseStore, items: [], choices: [], decisionUpdatedAt: null, continuation: null, writingEnabled: false });
    if (suffix === '/decisions/links' && method === 'GET') return json({ actions: [] });
  }
  if (pathname === '/api/case-relations' && method === 'GET') return json({ caseStoreId: ids.caseStore, items: [], continuation: null, hasMore: false, writingEnabled: false });
  const projectRoute = /^\/api\/projects\/([^/]+)(.*)$/.exec(pathname);
  if (projectRoute) {
    const project = findProject(projectRoute[1]!); if (!project) return error('project_not_found', 404);
    const suffix = projectRoute[2]!;
    if (!suffix && method === 'GET') return json({ project });
    if (!suffix && method === 'PATCH') { project.name = input.name; return json({ project }); }
    if (suffix === '/archive' || suffix === '/restore') { project.archivedAt = suffix === '/archive' ? now() : null; return json({ project }); }
    if (suffix.startsWith('/plan')) return projectPlan(project, suffix.slice('/plan'.length), method, input);
    if (suffix === '/db-link/sources' && method === 'GET') return json({ sources: [], projectSources: [] });
    if (suffix === '/db-link/results' && method === 'GET') return json({ results: [] });
    if (suffix === '/files' && method === 'GET') return json({ files: ['010_draw', '020_clean', '060_reports'].map(name => ({ name, path: name, kind: 'directory', children: [] })) });
    if (suffix === '/work/events' && method === 'GET') return json({ events: [] });
    if (suffix === '/work' && method === 'PATCH') { project.work = { ...input, projectId: project.id, revision: (project.work?.revision ?? 0) + 1, createdAt: project.work?.createdAt ?? now(), updatedAt: now(), statusChangedAt: now() } as NonNullable<ClientProject['work']>; return json({ work: project.work }); }
    if (suffix === '/tasks' && method === 'POST') { const task = newTask(crypto.randomUUID(), input.name); project.tasks.push(task); return json({ task }, 201); }
    const taskRoute = /^\/tasks\/([^/]+)(.*)$/.exec(suffix);
    if (taskRoute) {
      const task = project.tasks.find(value => value.id === taskRoute[1]); if (!task) return error('task_not_found', 404);
      const taskSuffix = taskRoute[2]!;
      if (!taskSuffix && method === 'GET' || taskSuffix === '/open' && method === 'POST') return json({ project, task, snapshot: snapshot(project.id, task) });
      if (taskSuffix === '/events' && method === 'GET') return eventResponse(project.id, task, signal);
      if (taskSuffix === '/draft' && method === 'PATCH') { task.draft = input.text; return json({}); }
      if (taskSuffix === '/archive' || taskSuffix === '/restore') { task.archivedAt = taskSuffix === '/archive' ? now() : null; return json({ task }); }
      if (taskSuffix === '/stop' && method === 'POST') return json({ stopped: true });
      if (taskSuffix === '/messages' || taskSuffix === '/commands') return error('demo_model_execution_disabled', 403);
      if (taskSuffix === '/context-receipts' && method === 'GET') return json({ receipts: [] });
      if (taskSuffix === '/db-link/sources' && method === 'GET') return json({ sources: [], projectSources: [] });
      if (taskSuffix === '/sap-method-extractions' && method === 'GET') return json({ extractions: [] });
      if (taskSuffix === '/personal-context' && method === 'GET') return json({ entries: [], issues: [], partial: false });
      if (taskSuffix === '/automatic-verification/settings' && method === 'GET') return json({ settings: { projectId: project.id, taskId: task.id, formatVersion: 1, revision: 0, enabled: false, dataFiles: [], processFiles: [], maxAuthorTurns: 2 } });
      if (taskSuffix === '/automatic-verification/chains' && method === 'GET') return json({ chains: [] });
      if (taskSuffix === '/conclusion-reviews' && method === 'GET') return json({ reviews: [] });
      if (taskSuffix === '/automatic-verification/capabilities' && method === 'GET') return json({ available: false, reason: 'synthetic_demo_no_runtime' });
      if (taskSuffix === '/automatic-verification/status' && method === 'GET') return json({ projectId: project.id, taskId: task.id, busy: false, observation: null, available: false, state: 'disabled', chains: [] });
    }
  }
  if (pathname === '/api/automatic-actions/settings' && method === 'GET') return json(automatic);
  if (pathname === '/api/automatic-actions/settings' && method === 'POST') { automatic = { ...automatic, revision: automatic.revision + 1, nodes: input.nodes }; return json({ settings: automatic, replayed: false, operationRevision: automatic.revision }); }
  if (/^\/api\/automatic-actions\/settings\/operations\//.test(pathname)) return json({ operation: null });
  if (pathname === '/api/connectors/trade-area' && method === 'GET') return json({ available: false, reason: 'data_unavailable' });
  if (pathname === '/api/web-search/settings' && method === 'GET') return json({ order: ['minimax', 'deepseek'], configured: { minimax: false, deepseek: false } });
  return error('demo_endpoint_not_implemented', 503);
}
export function installDemoStub(): void {
  if (installed) return; installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (resource: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource), window.location.href);
    const method = (options?.method ?? (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
    if (url.origin !== window.location.origin) { requestLog.push({ method, path: url.origin + url.pathname, status: 'blocked-external' }); throw new TypeError('External network is disabled in this synthetic UI Demo.'); }
    if (!url.pathname.startsWith('/api/')) return originalFetch(resource, options);
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let input: Data = {};
    try { const raw = options?.body ?? (resource instanceof Request && !['GET', 'HEAD'].includes(method) ? await resource.clone().text() : undefined); if (typeof raw === 'string' && raw) input = JSON.parse(raw); }
    catch { return error('invalid_demo_request'); }
    let response: Response;
    try { response = await route(url, method, input, options?.signal ?? (resource instanceof Request ? resource.signal : undefined)); }
    catch (fault) { response = json({ code: 'demo_stub_error', message: fault instanceof Error ? fault.message : String(fault), synthetic: true }, 500); }
    requestLog.push({ method, path: url.pathname + url.search, status: response.status, synthetic: true });
    if (requestLog.length > 300) requestLog.shift();
    return response;
  }) as typeof window.fetch;
  (window as any).__optracallDemo = { synthetic: true, snapshot: getDemoSnapshot, setFailure: setDemoFailure, requests: requestLog };
}
