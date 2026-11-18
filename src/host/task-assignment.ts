// Task purpose is user-selected. A missing assignment on a historical Task has no inferred type.
export const taskTypes = ['requirement', 'analysis', 'plan', 'decision', 'do', 'teach'] as const;
export type TaskType = typeof taskTypes[number];
export const taskPurpose: Record<TaskType, { label: string; skill: string; deliverable: string }> = {
  requirement: { label: '需求 Requirement', skill: 'business-requirement', deliverable: '待决问题、范围、判断标准和资料缺口' },
  analysis: { label: '分析 Analysis', skill: 'data-analysis', deliverable: '可核对的发现、证据、备选解释及改判条件' },
  plan: { label: '计划 Plan', skill: 'business-plan', deliverable: '具体行动方案、备选、负责人、资源、时间、观察指标及退出条件' },
  decision: { label: '决策 Decision', skill: 'business-decision', deliverable: '对照标准比较准确方案、风险，提交负责人取舍' },
  do: { label: '执行 Do', skill: 'business-do', deliverable: '按实际授权记录行动、偏差、未执行原因和观察' },
  teach: { label: '反馈 Teach', skill: 'business-teach', deliverable: '对照当时预期与实际观察，提出改判、下一步或结轮理由' },
};
export const approvedTaskSkills: Partial<Record<TaskType, { id: string; version: string; sha256: string }>> = {
  analysis: { id: 'data-analysis', version: '2.0.0-candidate.1', sha256: '05402899ac630de257799686828ae4b8a5f2ec1056427f711cc79a9eaf6ce0f6' },
};
export interface TaskCaseIssue { caseId: string; issueId: string; choiceId?: string; authorizationId?: string; feedbackRevisionId?: string }
export interface TaskSourceSelection { taskId: string; key: string }
export interface TaskAssignment {
  type: TaskType;
  skill: { id: string; version: string; sha256: string } | null;
  agreementVersion?: number;
  planAgreement?: { confirmationId: string; version: number };
  issue?: TaskCaseIssue;
  sources?: TaskSourceSelection[];
}
export interface ProjectStage { version: number; operationId: string; goal: string; condition: string; done: boolean; recordedAt: string }
export interface ProjectStageInput { expectedVersion: number; operationId: string; goal: string; condition: string; done: boolean }
export interface ProjectAgreement { version: number; text: string; operationId: string; confirmedAt: string }
export type TaskCreateIntent = Partial<TaskCaseIssue> & { type?: TaskType; sources?: TaskSourceSelection[] };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function makeTaskAssignment(type: unknown, enabled: unknown): TaskAssignment {
  if (!taskTypes.includes(type as TaskType) || typeof enabled !== 'boolean') throw new Error('invalid_task_assignment');
  const skill = approvedTaskSkills[type as TaskType];
  if (enabled && !skill) throw new Error('task_skill_unavailable');
  return { type: type as TaskType, skill: enabled && skill ? { ...skill } : null };
}
export function parseTaskAssignment(value: unknown): TaskAssignment {
  if (!object(value) || !taskTypes.includes(value.type as TaskType) || Object.keys(value).some(k => !['type', 'skill', 'issue', 'agreementVersion', 'planAgreement', 'sources'].includes(k))) throw new Error('invalid_task_assignment');
  const raw = value.skill;
  if (raw !== null && (!object(raw) || raw.id !== taskPurpose[value.type as TaskType].skill || typeof raw.version !== 'string' || !raw.version || raw.version.length > 128 || typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256))) throw new Error('invalid_task_skill');
  const skill = raw === null ? null : { id: raw.id as string, version: raw.version as string, sha256: raw.sha256 as string };
  const assignment: TaskAssignment = { type: value.type as TaskType, skill };
  if (value.agreementVersion !== undefined) {
    if (!Number.isSafeInteger(value.agreementVersion) || Number(value.agreementVersion) < 1) throw new Error('invalid_task_agreement');
    assignment.agreementVersion = Number(value.agreementVersion);
  }
  if (value.planAgreement !== undefined) {
    const ref = value.planAgreement;
    if (assignment.agreementVersion || !object(ref) || !uuid(ref.confirmationId) || !Number.isSafeInteger(ref.version) || Number(ref.version) < 1) throw new Error('invalid_task_agreement');
    assignment.planAgreement = { confirmationId: ref.confirmationId, version: Number(ref.version) };
  }
  if (value.issue !== undefined) {
    const issue = value.issue;
    if (!object(issue) || !uuid(issue.caseId) || !uuid(issue.issueId) || (issue.choiceId !== undefined && !uuid(issue.choiceId))) throw new Error('invalid_task_issue');
    if (issue.authorizationId !== undefined && (assignment.type !== 'do' || !uuid(issue.choiceId) || !uuid(issue.authorizationId))) throw new Error('invalid_task_issue');
    if (issue.feedbackRevisionId !== undefined && (assignment.type !== 'teach' || !uuid(issue.choiceId) || !uuid(issue.feedbackRevisionId))) throw new Error('invalid_task_issue');
    assignment.issue = { ...(issue.authorizationId ? { authorizationId:issue.authorizationId as string } : {}), ...(issue.feedbackRevisionId ? { feedbackRevisionId: issue.feedbackRevisionId as string } : {}), caseId: issue.caseId, issueId: issue.issueId, ...(issue.choiceId ? { choiceId: issue.choiceId as string } : {}) };
  }
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.length > 32 || !value.sources.every(s => object(s) && uuid(s.taskId) && typeof s.key === 'string' && /^[a-f0-9]{64}$/.test(s.key)) || new Set(value.sources.map(s => s.key)).size !== value.sources.length) throw new Error('invalid_task_sources');
    assignment.sources = value.sources.map(s => ({ taskId: s.taskId, key: s.key }));
  }
  return assignment;
}
