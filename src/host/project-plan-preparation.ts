import { createHash } from 'node:crypto';
import { canonicalDataContextValue } from './project-data-context-request.ts';
import { parseModelJson } from '../../extensions/business-plugins/requirements-elaboration/session/prompts.ts';
import { parseProjectPlanContent, ProjectPlanFault } from './project-plan-store.ts';
import type { ProjectPlanCapabilities, ProjectPlanContent, ProjectPlanDraftInput, ProjectPlanMeceReview } from './project-plan-types.ts';
export interface ProjectPlanPreparationInput {
  projectId: string;
  projectName: string;
  plan: ProjectPlanContent;
  capabilities: ProjectPlanCapabilities;
  goalContent?: readonly import('./strategy-goals-types.ts').GoalVersion[];
  capabilityIssues?: readonly { taskKey: string; capability: import('./project-plan-types.ts').ProjectPlanCapabilityRef; code: string; reason: string; issue?: unknown }[];
  existingTasks: readonly { id: string; name: string; archivedAt?: string | null }[];
}
export interface ProjectPlanPreparationOutput { plan: ProjectPlanContent; mece: ProjectPlanMeceReview; limitations: string[] }
export function projectPlanPreparationInputHash(input: ProjectPlanDraftInput): string { return createHash('sha256').update(canonicalDataContextValue(input)).digest('hex'); }
export function buildProjectPlanPreparationPrompt(input: ProjectPlanPreparationInput): string {
  const tasks = input.existingTasks.map(({ id, name, archivedAt }) => ({ id, name, archived: !!archivedAt }));
  const { skills, methods, connectors, materials, caseContexts } = input.capabilities;
  const ref = ({ kind, id, version, sha256, permissionRef }: ProjectPlanContent['materials'][number]) => ({ kind, id, ...(version === undefined ? {} : { version }), ...(sha256 === undefined ? {} : { sha256 }), ...(permissionRef === undefined ? {} : { permissionRef }) });
  const catalog = {
    skills: skills.map(({ id, title, version, sha256 }) => ({ id, title, version, sha256 })),
    methods: methods.map(({ id, title, version }) => ({ id, title, version })),
    connectors: connectors.map(({ id, title, enabled, requiresPermission, permissionRef, version, sha256, taskId }) => ({ id, title, enabled, requiresPermission, permissionRef, version, sha256, taskId })),
    materials: materials.map(material => ({ ...ref(material), title: material.title, ...(material.enabled === undefined ? {} : { enabled: material.enabled }) })),
    databaseSources: input.capabilities.databaseSources || [],
    caseContexts: caseContexts.map(({ caseId, title, primaryGoal, relatedGoals, caseRevision, projectWorkRevision }) => ({ caseId, title, primaryGoal, relatedGoals, caseRevision, projectWorkRevision })),
  };
  return `你是现有 Project 的需求梳理 Agent。本次只依据诉求、资料清单、已有说明和基本前提做轻量项目需求准备，输出未确认、可编辑的新草稿。
不得提前全面读取业务明细、试算或归因。本次没有数据工具，不读取文件内容、原生会话或任务草稿；不创建任何 Task，不启动任何分析，不执行经营动作，也不发布 RAP。
项目整体 TOC/TP 必选；具体树、专业工具、分析顺序与协作由后续 Agent 自主决定，可组合其他方法。不编造事实、数据内容、权限、Skill 或 IR；不足资料列入 limitations，保留未知。
开放分类，并做 MECE 自查：同层是否同维度、覆盖是否充分、边界是否重叠、深度是否合适。覆盖与本轮重点分开；不得把整棵问题树自动转成任务。以实际需要建议单 Task 或多 Task，综合责任优先复用明确的项目内任务，单任务由自身综合。
保留用户已选资料、所选 Skill／IR 的准确引用及权限引用，不静默取消或替换；所选方法后续必须实质使用。新增引用只取实际目录。保留 goalContext、caseContext 和 requirementRef 原值；goalContext 的准确目标版本和用户已明确用途不得改变、补猜或删除。无 Case 时不得臆造 Case；query（查询核对）、asset-construction（资产建设）和 assigned-work（已明确工作）可直接承接目标，case-investigation（持续经营事项调查）必须已有真实Case。已归档 Task 不参与本轮；existing taskId 只能引用已有任务。新任务仅提供稳定 key、名称与分工，不提供 taskId。依赖只是协作建议，不是 Host 固定执行顺序。
已确认错误的方法版本禁止采用。请说明具体影响、主动补证或提出替代；可以建议暂缓受影响Task（selected:false，保留原key及准确引用），继续独立可行的工作。不得默换新版或未发布纠正版；实质替换已选核心方法沿本方案一次集中确认，普通补证和方法内纠错不逐步审批。
项目：${JSON.stringify({ id: input.projectId, name: input.projectName })}
原轻量工作稿：${JSON.stringify(input.plan)}
原目标权威的准确已选版本（仅本次适用目标，不要求重抄或扩展全组织梳理）：${JSON.stringify(input.goalContent || [])}
能力可用性问题（元信息）：${JSON.stringify(input.capabilityIssues || [])}
已有任务（元信息）：${JSON.stringify(tasks)}
数据库来源仅为原保存配置、授权和Task排除状态；未试连、未取数、未核数据质量。建议须沿准确版本、范围、permissionRef及Task，选择不扩大权限或模型出口。已有授权无需再次索取，改选不得静默扩大。
实际能力及资料目录（元信息）：${JSON.stringify(catalog)}
仅输出 JSON 对象，顶层严格为 {"plan":<完整 ProjectPlanContent>,"mece":{"sameLevel":"同层检查说明","coverage":"覆盖检查说明","boundaries":"边界检查说明","depth":"深度检查说明"},"limitations":["实际缺口或限制，可为空"]}。
plan 沿原工作稿结构，必须包含 request、premises、materials、coverage、tasks、taskMode、summaryTaskKey、dependencies、caseContext；原 goalContext（{goal:{goalId,version},purpose:"query|asset-construction|assigned-work|case-investigation"}）和 requirementRef 若已存在必须准确保留，否则不得增加。coverage 每项为 {key,parentKey?,label,disposition:"focus|covered|deferred|unknown|out-of-scope",reason,taskKeys:[]}；tasks 每项为 {key,name,selected,taskId?,scope,capabilities:[]}。未选的新任务不能承接综合。所有 key 保持唯一；引用已有项须保留准确版本及 sha256/permissionRef，不输出目录标题字段到引用。`;
}
export function parseProjectPlanPreparationResponse(reply: string, input: ProjectPlanPreparationInput): ProjectPlanPreparationOutput {
  const value = parseModelJson(reply);
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const text = (item: unknown): item is string => typeof item === 'string' && !!item.trim() && item.length <= 20000 && !item.includes('\0');
  if (!object(value) || Object.keys(value).some(key => !['plan', 'mece', 'limitations'].includes(key)) || !object(value.mece) || Object.keys(value.mece).length !== 4 || !Array.isArray(value.limitations) || !value.limitations.every(text)) throw new ProjectPlanFault('project_plan_preparation_invalid', 422);
  const mece = value.mece;
  if (!['sameLevel', 'coverage', 'boundaries', 'depth'].every(key => text(mece[key]))) throw new ProjectPlanFault('project_plan_preparation_invalid', 422);
  const plan = parseProjectPlanContent(value.plan);
  const equal = (left: unknown, right: unknown) => canonicalDataContextValue(left ?? null) === canonicalDataContextValue(right ?? null);
  if (!equal(plan.goalContext, input.plan.goalContext) || !equal(plan.caseContext, input.plan.caseContext) || !equal(plan.requirementRef, input.plan.requirementRef)) throw new ProjectPlanFault('project_plan_preparation_context', 422);
  const identity = (ref: { kind: string; id: string; version?: string; sha256?: string; permissionRef?: string }) => canonicalDataContextValue({ kind: ref.kind, id: ref.id, ...(ref.version === undefined ? {} : { version: ref.version }), ...(ref.sha256 === undefined ? {} : { sha256: ref.sha256 }), ...(ref.permissionRef === undefined ? {} : { permissionRef: ref.permissionRef }) });
  const available = new Set([
    ...input.capabilities.skills.map(ref => identity({ ...ref, kind: 'skill' })),
    ...input.capabilities.methods.map(ref => identity({ ...ref, kind: 'sap-method' })),
    ...input.capabilities.connectors.filter(ref => ref.enabled).map(ref => identity({ ...ref, kind: 'connector' })),
    ...input.plan.tasks.flatMap(task => task.capabilities.map(identity)),
  ]);
  const materials = new Set([...input.capabilities.materials.filter(ref => ref.enabled !== false).map(identity), ...input.plan.materials.map(identity)]);
  if (plan.materials.some(ref => !materials.has(identity(ref))) || plan.tasks.some(task => task.capabilities.some(ref => !available.has(identity(ref))))) throw new ProjectPlanFault('project_plan_preparation_reference', 422);
  const participating = plan.tasks.filter(task => task.selected || task.key === plan.summaryTaskKey);
  const chosen = new Set(participating.flatMap(task => task.capabilities.map(identity)));
  // An unavailable original method may be retained for explaining/deferring its
  // own work. Moving it to an independent Task is neither a deferral nor a fix.
  for (const issue of input.capabilityIssues || []) {
    const originalOwners = new Set(input.plan.tasks.filter(task => task.capabilities.some(ref => identity(ref) === identity(issue.capability))).map(task => task.key));
    if (issue.code === 'project_plan_method_unavailable' && plan.tasks.some(task => !originalOwners.has(task.key) && task.capabilities.some(ref => identity(ref) === identity(issue.capability)))) throw new ProjectPlanFault('project_plan_preparation_selection', 422);
  }
  const deferred = (task: ProjectPlanContent['tasks'][number]) => {
    const next = plan.tasks.find(item => item.key === task.key && !item.selected && item.key !== plan.summaryTaskKey);
    return !!next && !!input.capabilityIssues?.some(issue => issue.taskKey === task.key && issue.code === 'project_plan_method_unavailable') && task.capabilities.every(ref => next.capabilities.some(item => identity(item) === identity(ref)));
  };
  if (input.plan.materials.some(ref => !plan.materials.some(next => identity(ref) === identity(next))) || input.plan.tasks.filter(task => task.selected || task.key === input.plan.summaryTaskKey).some(task => !deferred(task) && task.capabilities.some(ref => !chosen.has(identity(ref))))) throw new ProjectPlanFault('project_plan_preparation_selection', 422);
  for (const task of plan.tasks) {
    const actual = task.taskId && input.existingTasks.find(item => item.id === task.taskId);
    const original = input.plan.tasks.find(item => item.key === task.key);
    if (task.taskId && (!actual || actual.archivedAt && (task.selected || task.key === plan.summaryTaskKey)) || original?.taskId && original.taskId !== task.taskId) throw new ProjectPlanFault('project_plan_preparation_task', 422);
  }
  return { plan, mece: structuredClone(value.mece) as unknown as ProjectPlanMeceReview, limitations: [...value.limitations] };
}
